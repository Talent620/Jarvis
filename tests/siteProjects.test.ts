// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  saveSiteProject,
  listSiteProjects,
  getSiteProject,
  renameSiteProject,
  removeSiteProject,
  exportSiteProject,
  importSiteProject,
  buildProjectRecord,
} from "../src/lib/siteProjects";
import { store } from "../src/lib/store";

describe("siteProjects — buildProjectRecord (pure)", () => {
  it("nowy projekt zakłada pierwszą wersję", () => {
    const r = buildProjectRecord(undefined, { name: "A", html: "<h1>1</h1>" }, 1000, "id1");
    expect(r.id).toBe("id1");
    expect(r.versions).toHaveLength(1);
    expect(r.versions![0].html).toBe("<h1>1</h1>");
  });
  it("zmiana HTML dokłada wersję; brak zmiany nie dubluje", () => {
    const v1 = buildProjectRecord(undefined, { name: "A", html: "<h1>1</h1>" }, 1000, "id1");
    const v2 = buildProjectRecord(v1, { name: "A", html: "<h1>2</h1>" }, 2000, "id1");
    expect(v2.versions).toHaveLength(2);
    const v3 = buildProjectRecord(v2, { name: "A", html: "<h1>2</h1>" }, 3000, "id1");
    expect(v3.versions).toHaveLength(2); // ten sam HTML — bez nowej wersji
  });
});

describe("siteProjects — store", () => {
  beforeEach(() => store.setData((d) => { d.siteProjects = []; }));

  it("zapisuje, listuje i wczytuje po id", () => {
    const p = saveSiteProject({ name: "Landing", html: "<html>1</html>", prompt: "opis", kind: "landing", style: "stripe" });
    expect(listSiteProjects()).toHaveLength(1);
    const got = getSiteProject(p.id);
    expect(got?.kind).toBe("landing");
    expect(got?.style).toBe("stripe");
  });

  it("upsert po id aktualizuje ten sam projekt (nie tworzy nowego)", () => {
    const p = saveSiteProject({ name: "X", html: "<html>1</html>" });
    saveSiteProject({ id: p.id, name: "X", html: "<html>2</html>" });
    expect(listSiteProjects()).toHaveLength(1);
    expect(getSiteProject(p.id)?.html).toBe("<html>2</html>");
    expect(getSiteProject(p.id)?.versions).toHaveLength(2);
  });

  it("rename i remove działają", () => {
    const p = saveSiteProject({ name: "Stara", html: "<html>1</html>" });
    renameSiteProject(p.id, "Nowa nazwa");
    expect(getSiteProject(p.id)?.name).toBe("Nowa nazwa");
    removeSiteProject(p.id);
    expect(listSiteProjects()).toHaveLength(0);
  });

  it("eksport → import odtwarza projekt jako nowy", () => {
    const p = saveSiteProject({ name: "Eksport", html: "<html>abc</html>", kind: "sklep" });
    const json = exportSiteProject(p.id);
    store.setData((d) => { d.siteProjects = []; });
    const imp = importSiteProject(json);
    expect(imp).not.toBeNull();
    expect(imp?.html).toBe("<html>abc</html>");
    expect(imp?.kind).toBe("sklep");
    expect(listSiteProjects()).toHaveLength(1);
  });

  it("import odrzuca śmieci (brak html)", () => {
    expect(importSiteProject("{}")).toBeNull();
    expect(importSiteProject("nie-json")).toBeNull();
  });
});
