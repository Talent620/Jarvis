// Bezpieczny ewaluator arytmetyczny — BEZ Function()/eval. Obsługuje + - * / %,
// nawiasy, liczby dziesiętne i jednoargumentowy minus. Zwraca liczbę albo null
// (błędne/niedozwolone wyrażenie). Czyste i w pełni testowalne.

type Tok = { t: "num"; v: number } | { t: "op"; v: string };

function tokenize(input: string): Tok[] | null {
  const s = input.replace(/,/g, ".");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let n = "";
      while (i < s.length && /[0-9.]/.test(s[i])) n += s[i++];
      if ((n.match(/\./g) || []).length > 1) return null; // np. „1.2.3"
      const v = parseFloat(n);
      if (!isFinite(v)) return null;
      out.push({ t: "num", v });
      continue;
    }
    if ("+-*/%()".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    return null; // niedozwolony znak
  }
  return out;
}

const PREC: Record<string, number> = { "u-": 4, "*": 3, "/": 3, "%": 3, "+": 2, "-": 2 };

/** Shunting-yard → RPN, z rozpoznaniem jednoargumentowego minusa. */
function toRPN(tokens: Tok[]): Tok[] | null {
  const out: Tok[] = [];
  const ops: string[] = [];
  let prev: Tok | null = null;
  for (const tok of tokens) {
    if (tok.t === "num") { out.push(tok); prev = tok; continue; }
    const op = tok.v;
    if (op === "(") { ops.push(op); prev = tok; continue; }
    if (op === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push({ t: "op", v: ops.pop()! });
      if (!ops.length) return null; // niesparowany nawias
      ops.pop();
      prev = tok;
      continue;
    }
    // operator binarny lub jednoargumentowy minus/plus
    const unary = prev === null || (prev.t === "op" && prev.v !== ")");
    let cur = op;
    if (unary) {
      if (op === "+") { prev = tok; continue; } // jednoargumentowy plus = no-op
      if (op === "-") cur = "u-";
      else return null; // np. „*5" na starcie
    }
    const rightAssoc = cur === "u-";
    while (ops.length) {
      const top = ops[ops.length - 1];
      if (top === "(") break;
      if (PREC[top] > PREC[cur] || (!rightAssoc && PREC[top] === PREC[cur])) out.push({ t: "op", v: ops.pop()! });
      else break;
    }
    ops.push(cur);
    prev = tok;
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") return null; // niesparowany nawias
    out.push({ t: "op", v: op });
  }
  return out;
}

function evalRPN(rpn: Tok[]): number | null {
  const st: number[] = [];
  for (const tok of rpn) {
    if (tok.t === "num") { st.push(tok.v); continue; }
    if (tok.v === "u-") { const a = st.pop(); if (a === undefined) return null; st.push(-a); continue; }
    const b = st.pop(); const a = st.pop();
    if (a === undefined || b === undefined) return null;
    let r: number;
    switch (tok.v) {
      case "+": r = a + b; break;
      case "-": r = a - b; break;
      case "*": r = a * b; break;
      case "/": r = a / b; break;
      case "%": r = a % b; break;
      default: return null;
    }
    st.push(r);
  }
  if (st.length !== 1) return null;
  return isFinite(st[0]) ? st[0] : null;
}

/** Policz wyrażenie arytmetyczne bezpiecznie. null = błędne/niedozwolone. */
export function safeCalc(expr: string): number | null {
  const toks = tokenize(expr);
  if (!toks || !toks.length) return null;
  const rpn = toRPN(toks);
  if (!rpn || !rpn.length) return null;
  return evalRPN(rpn);
}
