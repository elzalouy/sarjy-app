import "server-only";
import type { StoredConversation } from "../database/conversations.ts";

export type PublicConversation = {
  id: string;
  status: "active" | "ended" | "failed";
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
};

export type PublicMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
};

export function toPublicConversation(
  conversation: StoredConversation,
): PublicConversation {
  return {
    id: conversation.id,
    status: conversation.status,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    endedAt: conversation.endedAt,
  };
}

export function toPublicMessage(message: {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}): PublicMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}
