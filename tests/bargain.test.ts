import { describe, it, expect } from "vitest";
import {
  marketLinks,
  parseBargain,
  normalizeOffers,
  toNumber,
  median,
  dealFlag,
  rankOffers,
  buildBargainPrompt,
  type Offer,
} from "../src/lib/bargain";

describe("marketLinks", () => {
  it("zwraca komplet serwisów posortowanych od najtańszych", () => {
    const links = marketLinks("lampa do golfa");
    const names = links.map((l) => l.name);
    expect(names).toContain("OLX");
    expect(names).toContain("Vinted");
    expect(names).toContain("Amazon");
    expect(names).toContain("Allegro (nowe)");
    expect(names.some((n) => n.startsWith("eBay"))).toBe(true);
  });

  it("koduje zapytanie i ustawia sortowanie rosnące po cenie", () => {
    const links = marketLinks("iphone 13");
    const amazon = links.find((l) => l.name === "Amazon")!;
    expect(amazon.url).toContain("k=iphone%2013");
    expect(amazon.url).toContain("s=price-asc-rank");
    const olx = links.find((l) => l.name === "OLX")!;
    expect(olx.url).toContain("q-iphone-13"); // OLX: spacje → myślniki w ścieżce
    expect(olx.url).toContain("filter_float_price:asc");
  });

  it("dla pustego zapytania zwraca pustą listę", () => {
    expect(marketLinks("   ")).toEqual([]);
  });

  it("oznacza serwisy jako used/new/all", () => {
    const links = marketLinks("rower");
    expect(links.find((l) => l.name === "OLX")!.kind).toBe("used");
    expect(links.find((l) => l.name === "Amazon")!.kind).toBe("new");
    expect(links.find((l) => l.name === "Google Zakupy")!.kind).toBe("all");
  });
});

describe("toNumber", () => {
  it("parsuje różne formaty cen", () => {
    expect(toNumber(1299)).toBe(1299);
    expect(toNumber("1 299,00 zł")).toBe(1299);
    expect(toNumber("1,299.00")).toBe(1299);
    expect(toNumber("199")).toBe(199);
    expect(toNumber("brak")).toBe(0);
    expect(toNumber(null)).toBe(0);
  });
});

describe("parseBargain", () => {
  it("parsuje czysty JSON", () => {
    const raw = '{"normalized":"lampa","currency":"PLN","offers":[{"title":"Lampa","price":49,"currency":"PLN","condition":"used","source":"OLX","url":"https://olx.pl/x"}],"tips":["Sprawdź stan"]}';
    const r = parseBargain(raw)!;
    expect(r.normalized).toBe("lampa");
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0].condition).toBe("used");
    expect(r.tips).toEqual(["Sprawdź stan"]);
  });

  it("radzi sobie z markdownem i otoczką tekstową", () => {
    const raw = 'Oto wyniki:\n```json\n{"offers":[{"title":"X","price":"1 200 zł","condition":"new","source":"Allegro","url":"https://allegro.pl/x"}]}\n```\nGotowe!';
    const r = parseBargain(raw)!;
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0].price).toBe(1200);
  });

  it("odrzuca oferty bez ceny lub bez poprawnego linku", () => {
    const raw = '{"offers":[{"title":"Zły","price":0,"url":"https://a.pl"},{"title":"Bez linku","price":10,"url":"nie-url"},{"title":"OK","price":10,"condition":"new","url":"https://a.pl/ok"}]}';
    const r = parseBargain(raw)!;
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0].title).toBe("OK");
  });

  it("zwraca null dla śmieci", () => {
    expect(parseBargain("zupełny bełkot bez json")).toBeNull();
    expect(parseBargain("")).toBeNull();
  });
});

describe("normalizeOffers", () => {
  it("domyślnie ustawia walutę PLN i wyciąga źródło z hosta", () => {
    const offers = normalizeOffers([{ title: "T", price: 5, condition: "new", url: "https://www.sklep.pl/a" }]);
    expect(offers[0].currency).toBe("PLN");
    expect(offers[0].source).toBe("sklep.pl");
  });
});

describe("median", () => {
  it("liczy medianę i ignoruje zera", () => {
    expect(median([10, 20, 30])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([0, 0, 100])).toBe(100);
    expect(median([])).toBe(0);
  });
});

describe("dealFlag", () => {
  const med = 100;
  it("flaguje podejrzanie tanie jako scam", () => {
    expect(dealFlag(40, med)).toBe("scam"); // < 45% mediany
  });
  it("rozpoznaje realną okazję", () => {
    expect(dealFlag(70, med)).toBe("deal"); // ≤ 80%
  });
  it("rozpoznaje drogie i normalne", () => {
    expect(dealFlag(140, med)).toBe("high"); // ≥ 130%
    expect(dealFlag(95, med)).toBe("fair");
  });
  it("bez mediany zwraca fair", () => {
    expect(dealFlag(50, 0)).toBe("fair");
  });
});

describe("rankOffers", () => {
  const offers: Offer[] = [
    { title: "Nowa droga", price: 300, currency: "PLN", condition: "new", source: "A", url: "https://a/1" },
    { title: "Używana tania", price: 80, currency: "PLN", condition: "used", source: "B", url: "https://a/2" },
    { title: "Nowa tania", price: 150, currency: "PLN", condition: "new", source: "C", url: "https://a/3" },
    { title: "Używana droższa", price: 120, currency: "PLN", condition: "used", source: "D", url: "https://a/4" },
  ];
  it("sortuje rosnąco po cenie", () => {
    const r = rankOffers(offers);
    expect(r.sorted.map((o) => o.price)).toEqual([80, 120, 150, 300]);
  });
  it("wskazuje najtańszą nową i najtańszą używaną", () => {
    const r = rankOffers(offers);
    expect(r.cheapestNew!.price).toBe(150);
    expect(r.cheapestUsed!.price).toBe(80);
  });
  it("zwraca medianę", () => {
    expect(rankOffers(offers).median).toBe(135); // (120+150)/2
  });
  it("radzi sobie z brakiem ofert danego typu", () => {
    const onlyUsed = rankOffers([offers[1]]);
    expect(onlyUsed.cheapestNew).toBeNull();
    expect(onlyUsed.cheapestUsed!.price).toBe(80);
  });
});

describe("buildBargainPrompt", () => {
  it("zawiera region i wymóg czystego JSON", () => {
    const p = buildBargainPrompt("Polska");
    expect(p).toContain("Polska");
    expect(p.toLowerCase()).toContain("json");
    expect(p).toContain("condition");
  });
});
