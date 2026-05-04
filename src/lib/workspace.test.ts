import { describe, expect, it } from "vitest";
import {
  chooseActiveTabAfterClose,
  closeLayoutTab,
  createDefaultLayoutDraft,
  createLayoutTab,
  draftTitle,
  parseSavedWorkspace,
  syncActiveTab
} from "./workspace";

describe("workspace tabs", () => {
  it("migrates legacy single-layout drafts into one workspace tab", () => {
    const workspace = parseSavedWorkspace({
      version: 1,
      surface: { label: "旧方案", width: 1200, height: 600 },
      tileSpec: { width: 600, height: 600, grout: 0, pattern: "straight" },
      origin: { anchorX: "start", anchorY: "start", offsetX: 0, offsetY: 0 },
      defaultVisual: { mode: "color", color: "#ffffff" },
      updatedAt: "2026-04-30T00:00:00.000Z"
    });

    expect(workspace?.version).toBe(2);
    expect(workspace?.tabs).toHaveLength(1);
    expect(workspace?.activeTabId).toBe("legacy-tab");
    expect(workspace?.tabs[0].title).toBe("旧方案");
  });

  it("creates a blank default draft for new layout tabs", () => {
    const draft = createDefaultLayoutDraft();

    expect(draft.surface).toMatchObject({ label: "", width: 3600, height: 2400 });
    expect(draft.tileSpec).toMatchObject({ width: 600, height: 600, grout: 3, pattern: "straight" });
    expect(draft.obstacles).toEqual([]);
    expect(draft.tileVisuals).toEqual({});
    expect(draft.textAnnotations).toEqual([]);
    expect(draftTitle(draft)).toBe("未命名排版");
  });

  it("saves the active tab draft before switching away", () => {
    const first = createLayoutTab("tab-1");
    const second = createLayoutTab("tab-2");
    const activeDraft = { ...first.draft, surface: { ...first.draft.surface, label: "已修改方案" } };

    const tabs = syncActiveTab([first, second], "tab-1", activeDraft);

    expect(tabs[0].title).toBe("已修改方案");
    expect(tabs[0].draft.surface.label).toBe("已修改方案");
    expect(tabs[1].title).toBe("未命名排版");
  });

  it("chooses an adjacent tab when closing the active tab", () => {
    const tabs = [createLayoutTab("tab-1"), createLayoutTab("tab-2"), createLayoutTab("tab-3")];

    expect(chooseActiveTabAfterClose(tabs, "tab-2", "tab-2")).toBe("tab-3");
    expect(chooseActiveTabAfterClose(tabs, "tab-3", "tab-3")).toBe("tab-2");
    expect(chooseActiveTabAfterClose(tabs, "tab-1", "tab-2")).toBe("tab-1");
  });

  it("keeps at least one tab when closing layouts", () => {
    const onlyTab = createLayoutTab("tab-1");
    const single = closeLayoutTab([onlyTab], "tab-1", "tab-1");
    expect(single.tabs).toHaveLength(1);
    expect(single.activeTabId).toBe("tab-1");

    const result = closeLayoutTab([onlyTab, createLayoutTab("tab-2")], "tab-1", "tab-1");
    expect(result.tabs.map((tab) => tab.id)).toEqual(["tab-2"]);
    expect(result.activeTabId).toBe("tab-2");
  });
});
