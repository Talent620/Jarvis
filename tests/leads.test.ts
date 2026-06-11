// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { runTool } from "../src/lib/tools";
import { riskOf } from "../src/lib/permissions";
import { store } from "../src/lib/store";

beforeEach(() => store.setData((d) => { d.leads = []; }));

describe("Pulpit Sprzedaży — leady", () => {
  it("save_lead zapisuje firmę ze statusem 'new'", async () => {
    expect(await runTool("save_lead", { company: "Dent-Med", url: "dentmed.pl", value: 1500, niche: "stomatolog", location: "Gdańsk" })).toMatch(/Zapisałem/);
    const l = store.data.leads[0];
    expect(l.company).toBe("Dent-Med");
    expect(l.status).toBe("new");
    expect(l.value).toBe(1500);
  });

  it("save_lead dedupe po nazwie (aktualizuje)", async () => {
    await runTool("save_lead", { company: "Dent-Med" });
    await runTool("save_lead", { company: "Dent-Med", contact: "biuro@dentmed.pl", value: 2000 });
    expect(store.data.leads).toHaveLength(1);
    expect(store.data.leads[0].contact).toBe("biuro@dentmed.pl");
    expect(store.data.leads[0].value).toBe(2000);
  });

  it("list_leads pokazuje status i wartość", async () => {
    await runTool("save_lead", { company: "Salon Ola", value: 900 });
    const out = await runTool("list_leads", {});
    expect(out).toContain("Salon Ola");
    expect(out).toMatch(/nowy/);
    expect(out).toContain("900");
  });

  it("save_lead = write, list_leads/find_leads = read", () => {
    expect(riskOf("save_lead")).toBe("write");
    expect(riskOf("list_leads")).toBe("read");
    expect(riskOf("find_leads")).toBe("read");
  });
});
