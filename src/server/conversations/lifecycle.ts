import "server-only";

export type ConversationStatus = "active" | "ended" | "failed";
export type ConversationEvent = "end" | "fail";

export class InvalidConversationTransition extends Error {
  constructor() {
    super("That conversation cannot change state.");
    this.name = "InvalidConversationTransition";
  }
}

/**
 * active can end or fail.
 * end on an ended conversation stays ended.
 * end on a failed conversation stays failed, so a failure is not rewritten as a clean end.
 * fail on a failed conversation stays failed.
 * fail on an ended conversation is rejected.
 * ended and failed never return to active.
 */
export function nextConversationStatus(
  status: ConversationStatus,
  event: ConversationEvent,
): ConversationStatus {
  if (event === "end") {
    if (status === "active") {
      return "ended";
    }
    if (status === "ended" || status === "failed") {
      return status;
    }
  }
  if (event === "fail") {
    if (status === "active") {
      return "failed";
    }
    if (status === "failed") {
      return "failed";
    }
  }
  throw new InvalidConversationTransition();
}
