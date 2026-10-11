import "server-only";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ConversationNotFoundError extends Error {
  constructor() {
    super("Not found.");
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationNotActiveError extends Error {
  constructor() {
    super("That conversation is not active.");
    this.name = "ConversationNotActiveError";
  }
}

export function conversationId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ConversationNotFoundError();
  }
  return value;
}
