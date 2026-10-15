import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PRESET_PERSONAS, type Persona } from "@/quant/personas";

interface PersonaState {
  /** Ids shown in the combined trade view. */
  followed: string[];
  custom: Persona[];
  toggle: (id: string) => void;
  follow: (id: string) => void;
  addCustom: (p: Persona) => void;
  removeCustom: (id: string) => void;
}

export const usePersonas = create<PersonaState>()(
  persist(
    (set, get) => ({
      followed: ["buffett", "huang"],
      custom: [],
      toggle: (id) => set({ followed: get().followed.includes(id) ? get().followed.filter((x) => x !== id) : [...get().followed, id] }),
      follow: (id) => { if (!get().followed.includes(id)) set({ followed: [...get().followed, id] }); },
      addCustom: (p) => set({
        custom: [...get().custom.filter((x) => x.id !== p.id), p],
        followed: get().followed.includes(p.id) ? get().followed : [...get().followed, p.id],
      }),
      removeCustom: (id) => set({ custom: get().custom.filter((x) => x.id !== id), followed: get().followed.filter((x) => x !== id) }),
    }),
    {
      name: "stockhub-personas",
      version: 2,
      // v1 followed congressional personas that no longer exist; keep only ids that still resolve
      migrate: () => ({ followed: ["buffett", "huang"], custom: [] }),
    },
  ),
);

export const allPersonas = (custom: Persona[]): Persona[] => [...PRESET_PERSONAS, ...custom];
