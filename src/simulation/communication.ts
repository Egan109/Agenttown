import { addMemory, makeMemory } from "../agents/memory";
import { applyInteraction, getRelationship } from "../agents/relationships";
import type { Agent, Message, MessageType, SocialIntent, WorldState } from "../types";
import { logEvent } from "./events";

const MAX_MESSAGES = 400;

/** Map a fine-grained social intent onto the coarse Message.type union. */
function intentToType(intent: SocialIntent): MessageType {
  switch (intent) {
    case "threat":
      return "threat";
    case "apologize":
      return "apology";
    case "gossip_positive":
    case "gossip_negative":
      return "gossip";
    case "invite":
      return "alliance_offer";
    case "ask_for_help":
      return "request_resource";
    case "share_idea":
    case "share_goal":
    case "disagree":
      return "proposal";
    default:
      return "greeting";
  }
}

/**
 * Record a finished social line (precomposed by social.ts): store the Message and
 * log the event. Relationship/memory effects are applied by the caller, so this is
 * purely the bookkeeping + log half.
 */
export function recordMessage(
  world: WorldState,
  from: Agent,
  to: Agent,
  intent: SocialIntent,
  content: string,
  severity: 0 | 1 | 2 = 0
): Message {
  const msg: Message = {
    fromAgentId: from.id,
    toAgentId: to.id,
    type: intentToType(intent),
    intent,
    content,
    tick: world.tick,
    day: world.day,
  };
  world.messages.push(msg);
  if (world.messages.length > MAX_MESSAGES) {
    world.messages.splice(0, world.messages.length - MAX_MESSAGES);
  }
  logEvent(world, "message", content, [from.id, to.id], severity);
  return msg;
}

/** Pick short, persona-flavored message text deterministically per type. */
export function composeMessage(from: Agent, to: Agent, type: MessageType): string {
  switch (type) {
    case "greeting":
      return `${from.name}: "Hello, ${to.name}."`;
    case "request_resource":
      return `${from.name}: "${to.name}, can you spare some food? I'm struggling."`;
    case "offer_trade":
      return `${from.name}: "${to.name}, want to trade? I have things to spare."`;
    case "warning":
      return `${from.name}: "${to.name}, be careful out there — it isn't safe."`;
    case "threat":
      return `${from.name}: "Stay out of my way, ${to.name}, or you'll regret it."`;
    case "proposal":
      return `${from.name}: "${to.name}, let's work together on this."`;
    case "confession":
      return `${from.name}: "${to.name}... there's something I have to tell you."`;
    case "gossip":
      return `${from.name} whispers something about someone to ${to.name}.`;
    case "alliance_offer":
      return `${from.name}: "${to.name}, stand with me and we both come out ahead."`;
    case "reproduction_proposal":
      return `${from.name}: "${to.name}, I'd like to build a family with you."`;
    case "law_proposal":
      return `${from.name}: "${to.name}, the village needs a rule about this."`;
    case "apology":
      return `${from.name}: "${to.name}, I'm sorry. I was wrong."`;
    default:
      return `${from.name} says something to ${to.name}.`;
  }
}

/**
 * Send a message, record it, and apply its light social consequences. Heavier
 * actions (attack, steal, share) go through their own systems; this handles the
 * purely verbal exchanges.
 */
export function sendMessage(
  world: WorldState,
  from: Agent,
  to: Agent,
  type: MessageType,
  content?: string
): Message {
  const msg: Message = {
    fromAgentId: from.id,
    toAgentId: to.id,
    type,
    content: content ?? composeMessage(from, to, type),
    tick: world.tick,
    day: world.day,
  };
  world.messages.push(msg);
  if (world.messages.length > MAX_MESSAGES) {
    world.messages.splice(0, world.messages.length - MAX_MESSAGES);
  }

  // Verbal social effects.
  switch (type) {
    case "greeting":
      applyInteraction(from, to.id, "greeting");
      applyInteraction(to, from.id, "greeting");
      break;
    case "threat":
      applyInteraction(to, from.id, "threat");
      break;
    case "apology":
      applyInteraction(to, from.id, "apology");
      break;
    case "alliance_offer":
    case "proposal": {
      const rel = getRelationship(to, from.id);
      rel.respect = Math.min(100, rel.respect + 3);
      break;
    }
    default:
      break;
  }

  const severity = type === "threat" || type === "alliance_offer" ? 2 : 0;
  logEvent(world, "message", msg.content, [from.id, to.id], severity as 0 | 2);

  // Memorable conversations leave a trace.
  if (type === "threat") {
    addMemory(
      to,
      makeMemory(world.tick, world.day, `${from.name} threatened me.`, "conflict", 45, [from.id])
    );
  } else if (type === "apology") {
    addMemory(
      to,
      makeMemory(world.tick, world.day, `${from.name} apologized to me.`, "positive", 25, [from.id])
    );
  }

  return msg;
}
