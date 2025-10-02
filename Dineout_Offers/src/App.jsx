import React, { useEffect, useState } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

/** -------------------- CONFIG -------------------- */
const LIST_FIELDS = {
  credit: ["Eligible Credit Cards", "Eligible Cards"],
  debit: ["Eligible Debit Cards", "Applicable Debit Cards"],
  title: ["Offer Title", "Title"],
  image: ["Image", "Credit Card Image", "Offer Image", "image", "Image URL"],
  link: ["Link", "Offer Link"],
  desc: ["Description", "Details", "Offer Description", "Flight Benefit"],
  // Permanent (inbuilt) CSV fields
  permanentCCName: ["Eligible Credit Cards"],
  permanentBenefit: ["Offer", "Benefit", "Offer", "Hotel Benefit"],
};

const MAX_SUGGESTIONS = 50;

/** Variant-note sites */
const VARIANT_NOTE_SITES = new Set(["Swiggy", "Zomato", "EazyDiner", "Permanent"]);

/** -------------------- HELPERS -------------------- */
const toNorm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function firstField(obj, keys) {
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== undefined &&
      obj[k] !== null &&
      String(obj[k]).trim() !== ""
    ) {
      return obj[k];
    }
  }
  return undefined;
}

function getCI(obj, key) {
  if (!obj) return undefined;
  const target = String(key).toLowerCase();
  for (const k of Object.keys(obj)) {
    if (String(k).toLowerCase() === target) return obj[k];
  }
  return undefined;
}

function splitList(val) {
  if (!val) return [];
  return String(val)
    .replace(/\n/g, " ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getBase(name) {
  if (!name) return "";
  return String(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function getVariant(name) {
  if (!name) return "";
  const m = String(name).match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
}

function brandCanonicalize(text) {
  let s = String(text || "");
  s = s.replace(/\bMakemytrip\b/gi, "MakeMyTrip");
  s = s.replace(/\bIcici\b/gi, "ICICI");
  s = s.replace(/\bHdfc\b/gi, "HDFC");
  s = s.replace(/\bSbi\b/gi, "SBI");
  s = s.replace(/\bIdfc\b/gi, "IDFC");
  s = s.replace(/\bPnb\b/gi, "PNB");
  s = s.replace(/\bRbl\b/gi, "RBL");
  s = s.replace(/\bYes\b/gi, "YES");
  return s;
}

function lev(a, b) {
  a = toNorm(a);
  b = toNorm(b);
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[n][m];
}

function scoreCandidate(q, cand) {
  const qs = toNorm(q);
  const cs = toNorm(cand);
  if (!qs) return 0;
  if (cs.includes(qs)) return 100;

  const qWords = qs.split(" ").filter(Boolean);
  const cWords = cs.split(" ").filter(Boolean);

  const matchingWords = qWords.filter((qw) => cWords.some((cw) => cw.includes(qw))).length;
  const sim = 1 - lev(qs, cs) / Math.max(qs.length, cs.length);
  return (matchingWords / Math.max(1, qWords.length)) * 0.7 + sim * 0.3;
}

function makeEntry(raw, type) {
  const base = brandCanonicalize(getBase(raw));
  return { type, display: base, baseNorm: toNorm(base) };
}

function normalizeUrl(u) {
  if (!u) return "";
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}
function normalizeText(s) {
  return toNorm(s || "");
}
function offerKey(offer) {
  const image = normalizeUrl(firstField(offer, LIST_FIELDS.image) || "");
  const title = normalizeText(firstField(offer, LIST_FIELDS.title) || offer.Website || "");
  const desc = normalizeText(firstField(offer, LIST_FIELDS.desc) || "");
  const link = normalizeUrl(firstField(offer, LIST_FIELDS.link) || "");
  return `${title}||${desc}||${image}||${link}`;
}

function dedupWrappers(arr, seen) {
  const out = [];
  for (const w of arr || []) {
    const k = offerKey(w.offer);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/** Disclaimer */
const Disclaimer = () => (
  <section className="disclaimer">
    <h3>Disclaimer</h3>
    <p>
      All offers, coupons, and discounts listed on our platform are provided for informational purposes only.
      We do not guarantee the accuracy, availability, or validity of any offer. Users are advised to verify the
      terms and conditions with the respective merchants before making any purchase. We are not responsible for any
      discrepancies, expired offers, or losses arising from the use of these coupons.
    </p>
  </section>
);

/** -------------------- COMPONENT -------------------- */
const AirlineOffers = () => {
  const [creditEntries, setCreditEntries] = useState([]);
  const [debitEntries, setDebitEntries] = useState([]);

  const [chipCC, setChipCC] = useState([]);
  const [chipDC, setChipDC] = useState([]);

  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // {type, display, baseNorm, _synthetic?}
  const [noMatches, setNoMatches] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const [swiggyOffers, setSwiggyOffers] = useState([]);
  const [zomatoOffers, setZomatoOffers] = useState([]);
  const [eazyOffers, setEazyOffers] = useState([]);
  const [permanentOffers, setPermanentOffers] = useState([]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // allCards for dropdown only
  useEffect(() => {
    async function loadAllCards() {
      try {
        const res = await axios.get(`/allCards.csv`);
        const parsed = Papa.parse(res.data, { header: true });
        const rows = parsed.data || [];

        const creditMap = new Map();
        const debitMap = new Map();

        for (const row of rows) {
          const ccList = splitList(firstField(row, LIST_FIELDS.credit));
          for (const raw of ccList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) creditMap.set(baseNorm, creditMap.get(baseNorm) || base);
          }
          const dcList = splitList(firstField(row, LIST_FIELDS.debit));
          for (const raw of dcList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) debitMap.set(baseNorm, debitMap.get(baseNorm) || base);
          }
        }

        const credit = Array.from(creditMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "credit"));
        const debit = Array.from(debitMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "debit"));

        setCreditEntries(credit);
        setDebitEntries(debit);
        setFilteredCards([
          ...(credit.length ? [{ type: "heading", label: "Credit Cards" }] : []),
          ...credit,
          ...(debit.length ? [{ type: "heading", label: "Debit Cards" }] : []),
          ...debit,
        ]);
        if (!credit.length && !debit.length) {
          setNoMatches(true);
          setSelected(null);
        }
      } catch (e) {
        console.error("allCards.csv load error:", e);
        setNoMatches(true);
        setSelected(null);
      }
    }
    loadAllCards();
  }, []);

  // offers (permanent, swiggy, zomato, eazydiner)
  useEffect(() => {
    async function loadOffers() {
      try {
        const files = [
          { name: "swiggy.csv", setter: setSwiggyOffers },
          { name: "zomato.csv", setter: setZomatoOffers },
          { name: "eazydiner.csv", setter: setEazyOffers },
          { name: "permanent.csv", setter: setPermanentOffers },
        ];
        await Promise.all(
          files.map(async (f) => {
            const res = await axios.get(`/${encodeURIComponent(f.name)}`);
            const parsed = Papa.parse(res.data, { header: true });
            f.setter(parsed.data || []);
          })
        );
      } catch (e) {
        console.error("Offer CSV load error:", e);
      }
    }
    loadOffers();
  }, []);

  // chips from offer CSVs only
  useEffect(() => {
    const ccMap = new Map();
    const dcMap = new Map();

    const harvestList = (val, targetMap) => {
      for (const raw of splitList(val)) {
        const base = brandCanonicalize(getBase(raw));
        const baseNorm = toNorm(base);
        if (baseNorm) targetMap.set(baseNorm, targetMap.get(baseNorm) || base);
      }
    };

    const harvestRows = (rows) => {
      for (const o of rows || []) {
        const ccField = firstField(o, LIST_FIELDS.credit);
        if (ccField) harvestList(ccField, ccMap);
        const dcField = firstField(o, LIST_FIELDS.debit);
        if (dcField) harvestList(dcField, dcMap);
      }
    };

    harvestRows(swiggyOffers);
    harvestRows(zomatoOffers);
    harvestRows(eazyOffers);

    setChipCC(Array.from(ccMap.values()).sort((a, b) => a.localeCompare(b)));
    setChipDC(Array.from(dcMap.values()).sort((a, b) => a.localeCompare(b)));
  }, [swiggyOffers, zomatoOffers, eazyOffers]);

  /** search box */
  const onChangeQuery = (e) => {
    const val = e.target.value;
    setQuery(val);

    if (!val.trim()) {
      setFilteredCards([]);
      setSelected(null);
      setNoMatches(false);
      return;
    }

    const q = val.trim().toLowerCase();
    const scored = (arr) =>
      arr
        .map((it) => {
          const s = scoreCandidate(val, it.display);
          const inc = it.display.toLowerCase().includes(q);
          return { it, s, inc };
        })
        .filter(({ s, inc }) => inc || s > 0.3)
        .sort((a, b) => (b.s - a.s) || a.it.display.localeCompare(b.it.display))
        .slice(0, MAX_SUGGESTIONS)
        .map(({ it }) => it);

    const cc = scored(creditEntries);
    const dc = scored(debitEntries);

    // determine debit intent
    const s = val.toLowerCase();
    const isDebitIntent = s.includes("debit") || /\bdebit\s*card(s)?\b/i.test(val) || /\bdc\b/i.test(val);

    if (!cc.length && !dc.length) {
      // No suggestions at all → show "no matching..." AND synthesize a selection
      setNoMatches(true);
      setFilteredCards([]);

      const synthetic = { type: isDebitIntent ? "debit" : "credit", display: val, baseNorm: toNorm(val), _synthetic: true };
      setSelected(synthetic);
      return;
    }

    setNoMatches(false);
    const listForDropdown = isDebitIntent
      ? [
          ...(dc.length ? [{ type: "heading", label: "Debit Cards" }] : []),
          ...dc,
          ...(cc.length ? [{ type: "heading", label: "Credit Cards" }] : []),
          ...cc,
        ]
      : [
          ...(cc.length ? [{ type: "heading", label: "Credit Cards" }] : []),
          ...cc,
          ...(dc.length ? [{ type: "heading", label: "Debit Cards" }] : []),
          ...dc,
        ];
    setFilteredCards(listForDropdown);

    // auto-pick exact match
    const qnorm = toNorm(val);
    const exactDC = debitEntries.find((x) => x.baseNorm === qnorm);
    const exactCC = creditEntries.find((x) => x.baseNorm === qnorm);
    if (exactDC) return onPick(exactDC);
    if (exactCC) return onPick(exactCC);

    // auto-pick when the prioritized bucket has exactly 1 suggestion
    const focus = isDebitIntent ? dc : cc;
    if (focus.length === 1) onPick(focus[0]);
  };

  useEffect(() => {
    const qnorm = toNorm(query);
    if (!qnorm) return;
    if (!selected || selected.baseNorm !== qnorm) {
      const exactDC = debitEntries.find((e) => e.baseNorm === qnorm);
      const exactCC = creditEntries.find((e) => e.baseNorm === qnorm);
      if (exactDC || exactCC) {
        const pick = exactDC || exactCC;
        setSelected(pick);
        setFilteredCards([]);
        setNoMatches(false);
      }
    }
  }, [query, debitEntries, creditEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = (entry) => {
    setSelected(entry);
    setQuery(entry.display);
    setFilteredCards([]);
    setNoMatches(false);
  };

  const onInputKeyDown = (e) => {
    if (e.key === "Enter") {
      const first = filteredCards.find((it) => it.type !== "heading");
      if (first) return onPick(first);

      // if nothing to pick, synthesize selection so "No offer..." can show
      if (!selected && query.trim()) {
        setSelected({ type: "credit", display: query, baseNorm: toNorm(query), _synthetic: true });
        setNoMatches(true);
      }
    }
  };

  const onInputBlur = () => {
    const first = filteredCards.find((it) => it.type !== "heading");
    if (first && !selected) onPick(first);
  };

  const handleChipClick = (name, type) => {
    const display = brandCanonicalize(getBase(name));
    const baseNorm = toNorm(display);
    setQuery(display);
    setSelected({ type, display, baseNorm });
    setFilteredCards([]);
    setNoMatches(false);
  };

  /** Build matches for one CSV: return wrappers {offer, site, variantText} */
  function matchesFor(offers, type, site) {
    if (!selected) return [];
    const out = [];
    for (const o of offers || []) {
      let list = [];
      if (type === "permanent") {
        const nm = firstField(o, LIST_FIELDS.permanentCCName);
        if (nm) list = [nm];
      } else if (type === "debit") {
        list = splitList(firstField(o, LIST_FIELDS.debit));
      } else {
        list = splitList(firstField(o, LIST_FIELDS.credit));
      }

      let matched = false;
      let matchedVariant = "";
      for (const raw of list) {
        const base = brandCanonicalize(getBase(raw));
        if (toNorm(base) === selected.baseNorm) {
          matched = true;
          const v = getVariant(raw);
          if (v) matchedVariant = v;
          break;
        }
      }
      if (matched) out.push({ offer: o, site, variantText: matchedVariant });
    }
    return out;
  }

  // Collect + dedup (permanent only if credit)
  const wPermanent = matchesFor(permanentOffers, "permanent", "Permanent");
  const wSwiggy = matchesFor(swiggyOffers, selected?.type === "debit" ? "debit" : "credit", "Swiggy");
  const wZomato = matchesFor(zomatoOffers, selected?.type === "debit" ? "debit" : "credit", "Zomato");
  const wEazy = matchesFor(eazyOffers, selected?.type === "debit" ? "debit" : "credit", "EazyDiner");

  const seen = new Set();
  const dPermanent = selected?.type === "credit" ? dedupWrappers(wPermanent, seen) : [];
  const dSwiggy = dedupWrappers(wSwiggy, seen);
  const dZomato = dedupWrappers(wZomato, seen);
  const dEazy = dedupWrappers(wEazy, seen);

  const hasAny = Boolean(dPermanent.length || dSwiggy.length || dZomato.length || dEazy.length);

  /** Offer card UI */
  const OfferCard = ({ wrapper, isPermanent = false }) => {
    const [copied, setCopied] = useState(false);
    const o = wrapper.offer;
    const siteKey = String(wrapper.site || "").toLowerCase();

    let title = firstField(o, LIST_FIELDS.title) || o.Website || "Offer";
    let desc = firstField(o, LIST_FIELDS.desc) || "";
    let image = firstField(o, LIST_FIELDS.image);
    let link = firstField(o, LIST_FIELDS.link);

    if (siteKey === "swiggy" || siteKey === "eazydiner") {
      title = getCI(o, "Offer") ?? title;
      desc = getCI(o, "Description") ?? desc;
      image = getCI(o, "Images") ?? image;
      link = getCI(o, "Link") ?? link;
    }

    // Zomato: Coupon Code + Description
    let couponCode;
    if (siteKey === "zomato") {
      couponCode = getCI(o, "Coupon Code");
      desc = getCI(o, "Description") ?? desc;
      image = getCI(o, "Images") ?? image;
      link = getCI(o, "Link") ?? link;
    }

    if (isPermanent) {
      desc = firstField(o, LIST_FIELDS.permanentBenefit) || desc;
    }

    const showVariantNote =
      VARIANT_NOTE_SITES.has(wrapper.site) &&
      wrapper.variantText &&
      wrapper.variantText.trim().length > 0;

    const onCopy = () => {
      if (!couponCode) return;
      navigator.clipboard?.writeText(String(couponCode)).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    };

    if (siteKey === "zomato") {
      return (
        <div className="offer-card">
          {image && <img src={image} alt={title || "Offer"} />}
          <div className="offer-info">
            {title && <h3 className="offer-title">{title}</h3>}

            {couponCode && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span
                  style={{
                    padding: "6px 10px",
                    border: "1px dashed #9aa4b2",
                    borderRadius: 6,
                    background: "#f7f9ff",
                    fontFamily: "monospace",
                  }}
                >
                  {couponCode}
                </span>
                <button
                  className="btn"
                  onClick={onCopy}
                  aria-label="Copy coupon code"
                  title="Copy coupon code"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span role="img" aria-hidden="true">📋</span> Copy
                </button>
                {copied && <span style={{ color: "#1e7145", fontSize: 14 }}>Copied!</span>}
              </div>
            )}

            {desc && <div className="offer-desc">{desc}</div>}

            {showVariantNote && (
              <p className="network-note" style={{ marginTop: 8 }}>
                <strong>Note:</strong> This benefit is applicable only on <em>{wrapper.variantText}</em> variant
              </p>
            )}

            {link && (
              <button className="btn" onClick={() => window.open(link, "_blank")}>
                View Offer
              </button>
            )}
          </div>
        </div>
      );
    }

    // Default (Swiggy, EazyDiner, Permanent)
    return (
      <div className="offer-card">
        {image && <img src={image} alt={title || "Offer"} />}
        <div className="offer-info">
          {title && <h3 className="offer-title">{title}</h3>}

          {isPermanent ? (
            <>
              {desc && <p className="offer-desc">{desc}</p>}
              <p className="inbuilt-note">
                <strong>This is a inbuilt feature of this credit card</strong>
              </p>
            </>
          ) : (
            desc && <p className="offer-desc">{desc}</p>
          )}

          {showVariantNote && (
            <p className="network-note" style={{ marginTop: 8 }}>
              <strong>Note:</strong> This benefit is applicable only on <em>{wrapper.variantText}</em> variant
            </p>
          )}

          {link && (
            <button className="btn" onClick={() => window.open(link, "_blank")}>
              View Offer
            </button>
          )}
        </div>
      </div>
    );
  };

  /** ---------- RENDER ---------- */
  const showNoMatchingText = noMatches && query.trim().length > 0;
  const showNoOfferText = selected && !hasAny && !noMatches;

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>
      {/* Chips */}
      {(chipCC.length > 0 || chipDC.length > 0) && (
        <div
          style={{
            maxWidth: 1200,
            margin: "14px auto 0",
            padding: "14px 16px",
            background: "#F7F9FC",
            border: "1px solid #E8EDF3",
            borderRadius: 10,
            boxShadow: "0 6px 18px rgba(15,23,42,.06)",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 16,
              color: "#1F2D45",
              marginBottom: 10,
              display: "flex",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span>Credit And Debit Cards Which Have Offers</span>
          </div>

          {chipCC.length > 0 && (
            <marquee direction="left" scrollamount="4" style={{ marginBottom: 8, whiteSpace: "nowrap" }}>
              <strong style={{ marginRight: 10, color: "#1F2D45" }}>Credit Cards:</strong>
              {chipCC.map((name, idx) => (
                <span
                  key={`cc-chip-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(name, "credit")}
                  onKeyDown={(e) => (e.key === "Enter" ? handleChipClick(name, "credit") : null)}
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    border: "1px solid #E0E6EE",
                    borderRadius: 9999,
                    marginRight: 8,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1.2,
                    userSelect: "none",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#F0F5FF")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
                  title="Click to select this card"
                >
                  {name}
                </span>
              ))}
            </marquee>
          )}

          {chipDC.length > 0 && (
            <marquee direction="left" scrollamount="4" style={{ whiteSpace: "nowrap" }}>
              <strong style={{ marginRight: 10, color: "#1F2D45" }}>Debit Cards:</strong>
              {chipDC.map((name, idx) => (
                <span
                  key={`dc-chip-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(name, "debit")}
                  onKeyDown={(e) => (e.key === "Enter" ? handleChipClick(name, "debit") : null)}
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    border: "1px solid #E0E6EE",
                    borderRadius: 9999,
                    marginRight: 8,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1.2,
                    userSelect: "none",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#F0F5FF")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
                  title="Click to select this card"
                >
                  {name}
                </span>
              ))}
            </marquee>
          )}
        </div>
      )}

      {/* Search / dropdown */}
      <div className="dropdown" style={{ position: "relative", width: "600px", margin: "20px auto" }}>
        <input
          type="text"
          value={query}
          onChange={onChangeQuery}
          onKeyDown={onInputKeyDown}
          onBlur={onInputBlur}
          placeholder="Type a Credit or Debit Card...."
          className="dropdown-input"
          style={{
            width: "100%",
            padding: "12px",
            fontSize: "16px",
            border: `1px solid ${noMatches ? "#d32f2f" : "#ccc"}`,
            borderRadius: "6px",
          }}
        />

        {query.trim() && !!filteredCards.length && (
          <ul
            className="dropdown-list"
            style={{
              listStyle: "none",
              padding: "10px",
              margin: 0,
              width: "100%",
              maxHeight: "260px",
              overflowY: "auto",
              border: "1px solid #ccc",
              borderRadius: "6px",
              backgroundColor: "#fff",
              position: "absolute",
              zIndex: 1000,
            }}
          >
            {filteredCards.map((item, idx) =>
              item.type === "heading" ? (
                <li key={`h-${idx}`} style={{ padding: "8px 10px", fontWeight: 700, background: "#fafafa" }}>
                  {item.label}
                </li>
              ) : (
                <li
                  key={`i-${idx}-${item.display}`}
                  onClick={() => onPick(item)}
                  style={{ padding: "10px", cursor: "pointer", borderBottom: "1px solid #f2f2f2" }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#f7f9ff")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {item.display}
                </li>
              )
            )}
          </ul>
        )}

        {/* Always-visible status line (makes the messages impossible to miss) */}
        <div aria-live="polite" style={{ textAlign: "center", marginTop: 8, minHeight: 22 }}>
          {showNoMatchingText && (
            <p style={{ color: "#d32f2f", margin: 0 }}>No matching cards found. Please try a different name.</p>
          )}
          {showNoOfferText && (
            <p style={{ color: "#d32f2f", margin: 0 }}>No offer available for this card</p>
          )}
        </div>
      </div>

      {/* Offers by section */}
      {selected && hasAny && !noMatches && (
        <div className="offers-section" style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
          {!!dPermanent.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Permanent Offers</h2>
              <div className="offer-grid">
                {dPermanent.map((w, i) => (
                  <OfferCard key={`perm-${i}`} wrapper={w} isPermanent />
                ))}
              </div>
            </div>
          )}

          {!!dSwiggy.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers On Swiggy</h2>
              <div className="offer-grid">
                {dSwiggy.map((w, i) => (
                  <OfferCard key={`sw-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dZomato.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers On Zomato</h2>
              <div className="offer-grid">
                {dZomato.map((w, i) => (
                  <OfferCard key={`zo-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dEazy.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers On EazyDiner</h2>
              <div className="offer-grid">
                {dEazy.map((w, i) => (
                  <OfferCard key={`ez-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selected && hasAny && !noMatches && (
        <button
          onClick={() => window.scrollBy({ top: window.innerHeight, behavior: "smooth" })}
          style={{
            position: "fixed",
            right: 20,
            bottom: isMobile ? 220 : 250,
            padding: isMobile ? "12px 15px" : "10px 20px",
            backgroundColor: "#1e7145",
            color: "white",
            border: "none",
            borderRadius: isMobile ? "50%" : 8,
            cursor: "pointer",
            fontSize: 18,
            zIndex: 1000,
            boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
            width: isMobile ? 50 : 140,
            height: isMobile ? 50 : 50,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {isMobile ? "↓" : "Scroll Down"}
        </button>
      )}

      <Disclaimer />
    </div>
  );
};

export default AirlineOffers;
