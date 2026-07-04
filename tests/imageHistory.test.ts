// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { saveImageEdit, listImageHistory, removeImageEdit, clearImageHistory } from "../src/lib/imageHistory";
import { store } from "../src/lib/store";

describe("imageHistory — historia przeróbek", () => {
  beforeEach(() => store.setData((d) => { d.imageHistory = []; }));

  it("zapisuje wynik na początku (najnowsze pierwsze) z promptem", () => {
    saveImageEdit({ data: "AAA", mediaType: "image/png" }, "zmień tło");
    saveImageEdit({ data: "BBB", mediaType: "image/png" }, "wyczyść");
    const h = listImageHistory();
    expect(h).toHaveLength(2);
    expect(h[0].data).toBe("BBB");
    expect(h[0].prompt).toBe("wyczyść");
  });

  it("nie dubluje obrazu identycznego tuż po sobie", () => {
    saveImageEdit({ data: "AAA", mediaType: "image/png" });
    saveImageEdit({ data: "AAA", mediaType: "image/png" });
    expect(listImageHistory()).toHaveLength(1);
  });

  it("pomija pusty obraz", () => {
    saveImageEdit({ data: "", mediaType: "image/png" });
    expect(listImageHistory()).toHaveLength(0);
  });

  it("usuwa po id i czyści całość", () => {
    saveImageEdit({ data: "AAA", mediaType: "image/png" });
    saveImageEdit({ data: "BBB", mediaType: "image/png" });
    const id = listImageHistory()[0].id;
    removeImageEdit(id);
    expect(listImageHistory()).toHaveLength(1);
    clearImageHistory();
    expect(listImageHistory()).toHaveLength(0);
  });
});
