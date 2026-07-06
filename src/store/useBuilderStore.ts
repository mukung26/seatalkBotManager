import { create } from "zustand";

interface BuilderStore {
  isOpen: boolean;
  target: "conversation" | "scheduler" | "rule" | null;
  initialPayload: any | null;
  openBuilder: (target: "conversation" | "scheduler" | "rule", initialPayload?: any) => void;
  closeBuilder: () => void;
  
  // A way to pass the result back to the caller
  onSaveCallback: ((payload: any) => void) | null;
  setOnSaveCallback: (cb: (payload: any) => void) => void;
}

export const useBuilderStore = create<BuilderStore>((set) => ({
  isOpen: false,
  target: null,
  initialPayload: null,
  onSaveCallback: null,
  openBuilder: (target, initialPayload) => set({ isOpen: true, target, initialPayload }),
  closeBuilder: () => set({ isOpen: false, target: null, initialPayload: null, onSaveCallback: null }),
  setOnSaveCallback: (cb) => set({ onSaveCallback: cb }),
}));
