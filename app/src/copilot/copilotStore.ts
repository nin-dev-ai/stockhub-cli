import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Answer } from "./assistant";

export interface ChatMessage { id: number; role: "user" | "assistant" | "system"; text?: string; answer?: Answer }

interface CopilotState {
  open: boolean;
  /** Session only; the conversation is not persisted. */
  messages: ChatMessage[];
  toggle: () => void;
  setOpen: (o: boolean) => void;
  /** Returns the new message id. */
  push: (m: Omit<ChatMessage, "id">) => number;
  update: (id: number, answer: Answer) => void;
  clear: () => void;
}

let seq = 0;
export const useCopilot = create<CopilotState>()(
  persist(
    (set, get) => ({
      open: false,
      messages: [],
      toggle: () => set({ open: !get().open }),
      setOpen: (open) => set({ open }),
      push: (m) => { const id = ++seq; set({ messages: [...get().messages, { ...m, id }].slice(-60) }); return id; },
      update: (id, answer) => set({ messages: get().messages.map((x) => (x.id === id ? { ...x, answer } : x)) }),
      clear: () => set({ messages: [] }),
    }),
    { name: "stockhub-copilot", partialize: (s) => ({ open: s.open }) },
  ),
);
