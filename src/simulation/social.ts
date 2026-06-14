// Deterministic social system.
//
// The talk action delegates here. Instead of mapping a stable relationship to one
// of four fixed lines (which collapses into the same utterance every tick), an
// agent runs a small scored loop:
//
//   needs -> pick INTENT -> pick TARGET -> pick TOPIC -> render LINE -> apply effects
//
// Variety is produced deterministically by (a) scoring many intents from needs,
// traits, relationship state and topics, and (b) anti-repetition cooldowns that
// penalise the recently-used intent / target / line. Same seed + state => same
// conversation, but it no longer flat-lines.

import { addMemory, makeMemory, memoriesAbout } from "../agents/memory";
import {
  applyInteraction,
  applyRelationshipDelta,
  getRelationship,
  relationshipWarmth,
} from "../agents/relationships";
import type {
  Agent,
  AgentSocialState,
  Message,
  Relationship,
  SocialAct,
  SocialIntent,
  WorldState,
} from "../types";
import { clamp100 } from "../util/math";
import { recordMessage } from "./communication";

// --- anti-repetition windows (measured in this agent's recent social acts) ---
const RECENT_CAP = 16;
const INTENT_WINDOW = 3; // penalise re-using the same intent within N acts
const TARGET_WINDOW = 2; // penalise re-addressing the same target within N acts
const LINEKEY_WINDOW = 6; // penalise the same template-family within N acts
const EXACTLINE_WINDOW = 12; // near-veto repeating an identical sentence
const REACT_TICKS = 10; // how recently an inbound line can still be "responded to"

function getSocial(agent: Agent): AgentSocialState {
  if (!agent.social) agent.social = { recent: [] };
  return agent.social;
}

// --- trait proxies: map the requested social traits onto the existing 33 traits ---
function kindness(a: Agent): number {
  return (a.traits.empathy + a.traits.cooperation + a.traits.fairness) / 3;
}
function gossipiness(a: Agent): number {
  return clamp100(a.traits.manipulativeness * 0.5 + (100 - a.traits.honesty) * 0.3 + a.traits.charisma * 0.2);
}
function insecurity(a: Agent): number {
  return clamp100(a.traits.anxiety * 0.6 + (100 - a.traits.emotionalStability) * 0.4);
}
function sociability(a: Agent): number {
  return (a.traits.charisma + a.traits.empathy) / 2;
}

// --- topic helpers --------------------------------------------------------
const NEED_LABEL: Record<string, string> = {
  hunger: "finding enough food",
  thirst: "getting water",
  shelter: "having no proper shelter",
  energy: "how exhausted I am",
  safety: "staying safe",
  social: "feeling so alone",
};

/** The agent's most pressing struggle, if any need is genuinely high. */
function topStruggle(a: Agent): { key: string; label: string } | null {
  const order: (keyof typeof a.needs)[] = ["hunger", "thirst", "shelter", "energy", "safety", "social"];
  let best: { key: string; label: string } | null = null;
  let bestV = 55; // threshold to count as a struggle worth voicing
  for (const k of order) {
    const v = a.needs[k] as number;
    if (v > bestV && NEED_LABEL[k]) {
      bestV = v;
      best = { key: k, label: NEED_LABEL[k] };
    }
  }
  return best;
}

/** Lowercase the first letter and strip trailing punctuation so a standalone
 *  sentence can be embedded mid-line ("...my plan is to {topic}."). */
function asClause(s: string): string {
  const trimmed = s.trim().replace(/[.!?]+$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** The agent's top active goal text (from the mind), as an embeddable clause. */
function topGoal(a: Agent): string | null {
  const g = a.mind.goals.filter((x) => x.status === "active").sort((x, y) => y.priority - x.priority)[0];
  return g ? asClause(g.description) : null;
}

/** A short phrase about the current state of the village, for ideas / check-ins. */
function worldConcern(world: WorldState): string {
  if (world.deathsToday > 0) return "we've lost someone recently";
  const pop = world.agentOrder.filter((id) => world.agents[id].alive).length;
  if (pop > 0 && world.conflictsToday / pop > 0.3) return "all this fighting lately";
  return "how the village is holding up";
}

/** Pick a third party to gossip about: someone the speaker has strong feelings on. */
function gossipSubject(
  world: WorldState,
  speaker: Agent,
  listener: Agent
): { id: string; positive: boolean } | null {
  let bestId: string | null = null;
  let bestPos = false;
  let bestScore = 0;
  for (const id in speaker.relationships) {
    if (id === listener.id || id === speaker.id) continue;
    const other = world.agents[id];
    if (!other || !other.alive) continue;
    const rel = speaker.relationships[id];
    if (rel.familiarity < 8) continue;
    const warmth = relationshipWarmth(rel);
    const intensity = Math.max(warmth - 50, rel.resentment, 50 - warmth);
    if (intensity > bestScore) {
      bestScore = intensity;
      bestId = id;
      bestPos = warmth >= 55 && rel.resentment < 25;
    }
  }
  return bestId && bestScore > 18 ? { id: bestId, positive: bestPos } : null;
}

// --- cooldown penalty -----------------------------------------------------
function recencyPenalty(
  recent: SocialAct[],
  predicate: (a: SocialAct) => boolean,
  window: number,
  strength: number
): number {
  // recent is newest-last; distance 1 = the most recent act.
  for (let i = recent.length - 1, dist = 1; i >= 0 && dist <= window; i--, dist++) {
    if (predicate(recent[i])) return strength * ((window - dist + 1) / window);
  }
  return 0;
}

// --- line templates -------------------------------------------------------
// {me} {you} {subject} {topic} are filled in. Multiple variants per intent; the
// least-recently-said one wins (deterministic), which kills verbatim repeats.
const TEMPLATES: Record<SocialIntent, string[]> = {
  greet: [`Hello, {you}.`, `Good to see you, {you}.`, `{you}. How are you holding up?`],
  check_in: [
    `{you}, you've been on my mind — are you alright?`,
    `How are you really doing, {you}?`,
    `Just checking on you, {you}. Today was rough.`,
  ],
  share_idea: [
    `I've been thinking about {topic}. I have an idea.`,
    `{you}, here's a thought on {topic}.`,
    `What if we tried something different about {topic}?`,
  ],
  share_goal: [
    `What I really want is to {topic}.`,
    `{you}, my plan is to {topic}.`,
    `I'm set on this: {topic}.`,
  ],
  share_struggle: [
    `Honestly, {you}, I'm struggling with {topic}.`,
    `It's hard right now — {topic} is wearing me down.`,
    `{you}, I don't know how much longer I can keep {topic}.`,
  ],
  ask_for_help: [
    `{you}, could you help me with {topic}?`,
    `I can't do this alone — {topic}. Will you help?`,
    `{you}, I need a hand with {topic}.`,
  ],
  compliment: [
    `For what it's worth, {you}, you've been carrying a lot.`,
    `{you}, your work hasn't gone unnoticed.`,
    `I mean it, {you} — you're good at what you do.`,
  ],
  thank: [
    `Thank you, {you}. I needed that.`,
    `{you}, I won't forget what you did for me.`,
    `I owe you one, {you}.`,
  ],
  reassure: [
    `It's going to be alright, {you}. We'll get through this.`,
    `{you}, don't lose heart. I've got your back.`,
    `Steady, {you}. You're not in this alone.`,
  ],
  invite: [
    `{you}, work with me on this — we'll both come out ahead.`,
    `Join me, {you}. Together we can manage {topic}.`,
    `{you}, let's team up.`,
  ],
  disagree: [
    `I don't see it that way, {you}.`,
    `With respect, {you}, I think that's wrong.`,
    `{you}, I can't agree — there's a better way.`,
  ],
  apologize: [
    `{you}, I'm sorry. I was wrong.`,
    `I owe you an apology, {you}.`,
    `{you}... I shouldn't have. Forgive me.`,
  ],
  gossip_positive: [
    `Between us, {you} — {subject} has really come through lately.`,
    `{you}, have you noticed how dependable {subject} has been?`,
    `I'll say this for {subject}: they've earned some trust.`,
  ],
  gossip_negative: [
    `Quietly, {you} — I wouldn't trust {subject} too far.`,
    `{you}, watch yourself around {subject}. Just saying.`,
    `Did you see what {subject} pulled? Doesn't sit right with me.`,
  ],
  threat: [
    `Stay out of my way, {you}, or you'll regret it.`,
    `Push me again, {you}, and see what happens.`,
  ],
};

function render(tpl: string, me: string, you: string, subject: string, topic: string): string {
  return tpl
    .replace(/\{me\}/g, me)
    .replace(/\{you\}/g, you)
    .replace(/\{subject\}/g, subject)
    .replace(/\{topic\}/g, topic);
}

/** Choose the least-recently-said template variant for this intent (anti-repeat). */
function pickTemplate(
  recent: SocialAct[],
  intent: SocialIntent,
  me: string,
  you: string,
  subject: string,
  topic: string
): string {
  const tpls = TEMPLATES[intent];
  let bestLine = render(tpls[0], me, you, subject, topic);
  let bestDist = -1;
  for (const tpl of tpls) {
    const line = render(tpl, me, you, subject, topic);
    let dist = EXACTLINE_WINDOW + 1; // never said => maximally fresh
    for (let i = recent.length - 1, d = 1; i >= 0 && d <= EXACTLINE_WINDOW; i--, d++) {
      if (recent[i].line === line) {
        dist = d;
        break;
      }
    }
    if (dist > bestDist) {
      bestDist = dist;
      bestLine = line;
    }
  }
  return bestLine;
}

// --- intent scoring -------------------------------------------------------
export type Candidate = {
  intent: SocialIntent;
  targetId: string;
  subjectId?: string;
  line: string;
  lineKey: string;
  score: number;
};

/** Score one intent toward one target; returns null if it doesn't apply. */
function scoreIntent(
  world: WorldState,
  agent: Agent,
  target: Agent,
  intent: SocialIntent,
  inbound: Message | null
): Candidate | null {
  const rel = getRelationship(agent, target.id);
  const warmth = relationshipWarmth(rel);
  const fam = rel.familiarity;
  const recent = getSocial(agent).recent;
  const t = agent.traits;

  let score = 8; // base
  let subjectId: string | undefined;
  let subjectName = "";
  let topic = "";
  let topicKind = "-";

  switch (intent) {
    case "greet":
      // Low-familiarity ice-breaker; fades as you get to know someone.
      score += sociability(agent) * 0.15 + (40 - fam) * 0.3 + agent.needs.social * 0.2;
      break;
    case "check_in":
      if (!(target.needs.shelter > 55 || target.health < 60 || world.deathsToday > 0)) return null;
      score += kindness(agent) * 0.4 + warmth * 0.2 + fam * 0.1;
      break;
    case "share_idea": {
      topic = topGoal(agent) ?? worldConcern(world);
      topicKind = "idea";
      score += t.creativity * 0.3 + t.curiosity * 0.2 + agent.mind.dailyPriorities.cooperation * 0.2 + fam * 0.1;
      break;
    }
    case "share_goal": {
      const g = topGoal(agent);
      if (!g) return null;
      topic = g;
      topicKind = "goal";
      score += t.ambition * 0.3 + warmth * 0.15 + fam * 0.2;
      break;
    }
    case "share_struggle": {
      const s = topStruggle(agent);
      if (!s) return null;
      topic = s.label;
      topicKind = "struggle:" + s.key;
      // Confide in those you trust; insecure agents vent more.
      score += insecurity(agent) * 0.3 + warmth * 0.25 + agent.needs.social * 0.2 + (rel.trust > 20 ? 12 : 0);
      break;
    }
    case "ask_for_help": {
      const s = topStruggle(agent);
      if (!s) return null;
      topic = s.label;
      topicKind = "help:" + s.key;
      score += (s.key === "shelter" ? 14 : 8) + rel.trust * 0.25 + warmth * 0.15 - t.pride * 0.2;
      break;
    }
    case "compliment":
      score += kindness(agent) * 0.35 + warmth * 0.25 + target.traits.industriousness * 0.1 - insecurity(agent) * 0.1;
      break;
    case "thank": {
      const helped = memoriesAbout(agent, target.id).some(
        (m) => m.type === "kindness" || m.type === "positive"
      );
      if (!helped) return null;
      topicKind = "thank";
      score += 16 + kindness(agent) * 0.2 + warmth * 0.15;
      break;
    }
    case "reassure":
      if (!(target.needs.shelter > 60 || target.health < 55 || target.mind.emotionalState.grief > 40)) return null;
      score += kindness(agent) * 0.4 + t.leadership * 0.15 + warmth * 0.2;
      break;
    case "invite": {
      topic = topGoal(agent) ?? "the work ahead";
      topicKind = "invite";
      score += t.cooperation * 0.3 + t.leadership * 0.2 + rel.trust * 0.2 + agent.mind.dailyPriorities.cooperation * 0.2;
      break;
    }
    case "disagree": {
      // Mostly a reaction to someone's idea/proposal; honest/proud agents do it.
      const reacting = inbound?.fromAgentId === target.id && (inbound.intent === "share_idea" || inbound.intent === "invite");
      if (!reacting && !(t.honesty > 60 && rel.resentment > 15)) return null;
      score += t.honesty * 0.2 + t.pride * 0.15 + rel.resentment * 0.2 + (reacting ? 22 : 0);
      break;
    }
    case "apologize":
      if (!(rel.resentment > 30 && t.forgiveness > 45)) return null;
      score += t.forgiveness * 0.3 + rel.resentment * 0.2 - t.pride * 0.2;
      break;
    case "gossip_positive":
    case "gossip_negative": {
      const subj = gossipSubject(world, agent, target);
      if (!subj || subj.positive !== (intent === "gossip_positive")) return null;
      subjectId = subj.id;
      subjectName = world.agents[subj.id]?.name ?? "someone";
      topicKind = "gossip:" + subj.id;
      // Gossip flows to those you're close to; gossipy agents do far more of it.
      // Negative gossip is sharpened by how much the speaker resents the subject.
      const subjResent = agent.relationships[subj.id]?.resentment ?? 0;
      score += gossipiness(agent) * 0.4 + rel.trust * 0.2 + fam * 0.2 + (intent === "gossip_negative" ? subjResent * 0.15 : 0);
      break;
    }
    case "threat":
      if (!(rel.resentment > 55 && t.aggression > 55)) return null;
      score += rel.resentment * 0.4 + t.aggression * 0.3 + t.intimidation * 0.2;
      break;
  }

  // Reactive bonus: responding to a fresh line aimed at me makes threads.
  if (inbound && inbound.fromAgentId === target.id) {
    const inv = inbound.intent;
    const responds =
      (inv === "compliment" && intent === "thank") ||
      (inv === "thank" && intent === "compliment") ||
      (inv === "share_struggle" && intent === "reassure") ||
      (inv === "ask_for_help" && (intent === "reassure" || intent === "invite")) ||
      (inv === "gossip_negative" && (intent === "gossip_negative" || intent === "disagree")) ||
      (inv === "gossip_positive" && intent === "gossip_positive") ||
      (inv === "greet" && (intent === "greet" || intent === "check_in")) ||
      (inv === "share_goal" && (intent === "compliment" || intent === "invite")) ||
      (inv === "threat" && (intent === "threat" || intent === "apologize"));
    if (responds) score += 20;
  }

  // Anti-repetition penalties.
  score -= recencyPenalty(recent, (a) => a.intent === intent, INTENT_WINDOW, 18);
  score -= recencyPenalty(recent, (a) => a.targetId === target.id, TARGET_WINDOW, 14);
  const lineKey = `${intent}:${topicKind}`;
  score -= recencyPenalty(recent, (a) => a.lineKey === lineKey, LINEKEY_WINDOW, 30);

  const line = pickTemplate(
    recent,
    intent,
    agent.name,
    target.name,
    subjectName,
    topic
  );
  // Strong veto if the exact rendered sentence was said very recently.
  score -= recencyPenalty(recent, (a) => a.line === line, EXACTLINE_WINDOW, 120);

  return { intent, targetId: target.id, subjectId, line, lineKey, score };
}

const ALL_INTENTS: SocialIntent[] = [
  "greet", "check_in", "share_idea", "share_goal", "share_struggle", "ask_for_help",
  "compliment", "thank", "reassure", "invite", "disagree", "apologize",
  "gossip_positive", "gossip_negative", "threat",
];

/** Most recent inbound line addressed to this agent from a still-nearby agent. */
function recentInbound(world: WorldState, agent: Agent, nearby: Agent[]): Message | null {
  const nearbyIds = new Set(nearby.map((a) => a.id));
  for (let i = world.messages.length - 1; i >= 0 && world.messages.length - i <= 40; i--) {
    const m = world.messages[i];
    if (m.toAgentId === agent.id && nearbyIds.has(m.fromAgentId) && world.tick - m.tick <= REACT_TICKS) {
      return m;
    }
  }
  return null;
}

/** Choose the best (intent, target) for this agent to say right now. */
export function chooseInteraction(
  world: WorldState,
  agent: Agent,
  nearby: Agent[]
): Candidate | null {
  if (nearby.length === 0) return null;
  const inbound = recentInbound(world, agent, nearby);
  const candidates = nearby.slice(0, 6);
  let best: Candidate | null = null;
  for (const target of candidates) {
    if (!target.alive) continue;
    for (const intent of ALL_INTENTS) {
      const c = scoreIntent(world, agent, target, intent, inbound);
      if (c && (!best || c.score > best.score)) best = c;
    }
  }
  return best;
}

// --- applying the chosen interaction --------------------------------------
function bumpFamiliarity(agent: Agent, target: Agent, amount: number): void {
  applyRelationshipDelta(getRelationship(agent, target.id), { familiarity: amount });
  applyRelationshipDelta(getRelationship(target, agent.id), { familiarity: amount });
}

function d(rel: Relationship, delta: Partial<Relationship>): void {
  applyRelationshipDelta(rel, delta);
}

/** Apply the social/relationship/memory consequences and log the line. */
export function performInteraction(world: WorldState, agent: Agent, target: Agent, c: Candidate): void {
  const relAT = getRelationship(agent, target.id); // agent -> target
  const relTA = getRelationship(target, agent.id); // target -> agent
  let severity: 0 | 1 | 2 = 0;

  switch (c.intent) {
    case "greet":
      d(relAT, { affection: 1, trust: 1 });
      d(relTA, { affection: 1, trust: 1 });
      break;
    case "check_in":
      d(relTA, { affection: 4, trust: 2 });
      d(relAT, { affection: 2 });
      break;
    case "compliment":
      d(relTA, { affection: 5, respect: 6 });
      target.mind.emotionalState.happiness = clamp100(target.mind.emotionalState.happiness + 4);
      addMemory(target, makeMemory(world.tick, world.day, `${agent.name} complimented me.`, "positive", 30, [agent.id]));
      break;
    case "thank":
      d(relTA, { affection: 4, trust: 3 });
      break;
    case "reassure":
      d(relTA, { affection: 5, trust: 4 });
      target.mind.emotionalState.hope = clamp100(target.mind.emotionalState.hope + 5);
      break;
    case "share_idea":
      d(relTA, { respect: 3 });
      break;
    case "share_goal":
      d(relTA, { trust: 2, respect: 2 });
      break;
    case "share_struggle":
      d(relTA, { affection: 3 });
      agent.mind.emotionalState.loneliness = clamp100(agent.mind.emotionalState.loneliness - 8);
      break;
    case "ask_for_help":
      d(relTA, { affection: 2 });
      d(relAT, { trust: 2 });
      break;
    case "invite":
      d(relTA, { respect: 3, trust: 2 });
      break;
    case "disagree":
      severity = 1;
      d(relTA, { resentment: 5, respect: 2 });
      d(relAT, { resentment: 2 });
      break;
    case "apologize":
      applyInteraction(target, agent.id, "apology"); // softens target's view of agent
      break;
    case "gossip_positive":
    case "gossip_negative": {
      // The listener's opinion of the SUBJECT shifts — event/opinion-based gossip.
      if (c.subjectId && world.agents[c.subjectId]?.alive) {
        const relTS = getRelationship(target, c.subjectId); // listener -> subject
        // Distortion: less-honest speakers swing it harder; a trusted speaker is believed more.
        const credibility = clamp100(40 + relTA.trust * 0.4) / 100;
        const force = (0.6 + (100 - agent.traits.honesty) / 200) * credibility;
        if (c.intent === "gossip_positive") {
          d(relTS, { respect: Math.round(8 * force), trust: Math.round(6 * force) });
          addMemory(target, makeMemory(world.tick, world.day, `${agent.name} spoke well of ${world.agents[c.subjectId].name}.`, "positive", 22, [c.subjectId]));
        } else {
          severity = 1;
          d(relTS, { trust: -Math.round(8 * force), resentment: Math.round(7 * force) });
          addMemory(target, makeMemory(world.tick, world.day, `${agent.name} warned me about ${world.agents[c.subjectId].name}.`, "negative", 26, [c.subjectId]));
        }
      }
      // Sharing gossip bonds speaker and listener a little.
      d(relTA, { trust: 2 });
      d(relAT, { trust: 2 });
      break;
    }
    case "threat":
      severity = 2;
      applyInteraction(target, agent.id, "threat");
      addMemory(target, makeMemory(world.tick, world.day, `${agent.name} threatened me.`, "conflict", 45, [agent.id]));
      break;
  }

  bumpFamiliarity(agent, target, c.intent === "greet" ? 3 : 4);

  // Record the line (Message + log) and the anti-repetition trace.
  recordMessage(world, agent, target, c.intent, c.line, severity);
  const rec = getSocial(agent).recent;
  rec.push({ tick: world.tick, intent: c.intent, targetId: target.id, lineKey: c.lineKey, line: c.line });
  if (rec.length > RECENT_CAP) rec.splice(0, rec.length - RECENT_CAP);
}
