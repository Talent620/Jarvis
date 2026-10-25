import { describe, it, expect } from "vitest";
import { declineName, resolveContact, pickCandidate, recipientTokens, instructionEmails, type Contact } from "../../src/lib/runtime/contacts";

const C = (id: string, name: string, email: string): Contact => ({ id, name, emails: [email], source: "fixture" });
const book = [
  C("m1", "Marcin Kubicki", "marcin.kubicki@example.com"),
  C("a1", "Anna Nowak", "anna@example.com"),
  C("t1", "Tomek Wiśniewski", "tomek@example.com"),
  C("p1", "Paweł Kowalski", "pawel@example.com"),
  C("k1", "Kasia Zielińska", "kasia@example.com"),
  C("j1", "Piotr Lewandowski", "piotr@example.com"),
  C("e1", "Magda Wójcik", "magda@example.com"),
];

describe("Polish name declension", () => {
  it.each([
    ["Marcin", ["marcina", "marcinowi", "marcinem", "marcinie"]],
    ["Piotr", ["piotra", "piotrowi", "piotrem", "piotrze"]],
    ["Tomek", ["tomka", "tomkowi", "tomkiem"]],
    ["Paweł", ["pawła", "pawłowi", "pawłem", "pawle"]],
    ["Kasia", ["kasi", "kasię", "kasią"]],
    ["Anna", ["anny", "annie", "annę", "anną"]],
    ["Magda", ["magdy", "magdzie", "magdę", "magdą"]],
    ["Kubicki", ["kubickiego", "kubickiemu", "kubickim"]],
    ["Zielińska", ["zielińskiej", "zielińską"]],
    ["Nowak", ["nowaka", "nowakowi", "nowakiem"]],
  ])("%s", (nom, forms) => {
    const got = declineName(nom);
    for (const f of forms) expect(got).toContain(f);
  });
});

describe("resolving the recipient from an utterance", () => {
  it.each([
    ["Wyślij to mailem Marcinowi.", "m1"],
    ["wyślij to do Marcina", "m1"],
    ["wyślij to mailem Marcinowi Kubickiemu", "m1"],
    ["wyslij to marcinowi", "m1"],
    ["wyślij Tomkowi", "t1"],
    ["prześlij to Pawłowi", "p1"],
    ["wyślij to Kasi", "k1"],
    ["wyślij to do Anny", "a1"],
    ["wyślij Piotrowi", "j1"],
    ["wyślij Magdzie", "e1"],
    ["wyślij to Marcinwi", "m1"], // STT typo, one edit
  ])("%s -> %s", (u, id) => {
    const r = resolveContact(u, book);
    expect(r.status === "resolved" && r.contact.id).toBe(id);
  });

  it("two Marcins: ambiguous with a short question; the surname or an ordinal picks one", () => {
    const two = [...book, C("m2", "Marcin Nowicki", "marcin.nowicki@example.com")];
    const r = resolveContact("Wyślij to mailem Marcinowi.", two);
    expect(r.status).toBe("ambiguous");
    if (r.status !== "ambiguous") return;
    expect(r.question).toBe("Którego: Marcin Kubicki czy Marcin Nowicki?");
    expect(pickCandidate("Kubickiemu", r.candidates)?.id).toBe("m1");
    expect(pickCandidate("temu drugiemu", r.candidates)?.id).toBe("m2");
    expect(pickCandidate("Nowickiemu", r.candidates)?.id).toBe("m2");
    expect(pickCandidate("nie wiem", r.candidates)).toBeNull();
    // With the surname in the command there is no question.
    const s = resolveContact("wyślij to Marcinowi Nowickiemu", two);
    expect(s.status === "resolved" && s.contact.id).toBe("m2");
  });

  it("no match is reported, never guessed", () => {
    expect(resolveContact("wyślij to Zbyszkowi", book).status).toBe("none");
  });

  it("e-mail addresses are taken from the instruction only, not as name tokens", () => {
    expect(instructionEmails("wyślij to na adres marcin@example.com")).toEqual(["marcin@example.com"]);
    expect(recipientTokens("wyślij to na adres marcin@example.com")).toEqual([]);
  });
});
