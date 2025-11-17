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
  permanentBenefit: ["Offer", "Benefit", "Grocery Benefits", "Hotel Benefit", "Movie Benefit"],
};

const MAX_SUGGESTIONS = 50;

/** Sites that should display the per-card variant note */
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
  const n = a.length,
    m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
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

  const matchingWords = qWords.filter((qw) =>
    cWords.some((cw) => cw.includes(qw))
  ).length;
  const sim = 1 - lev(qs, cs) / Math.max(qs.length, cs.length);
  return (matchingWords / Math.max(1, qWords.length)) * 0.7 + sim * 0.3;
}

/** 🔹 Generic fuzzy name matcher: handles typos like "selct", "reglia", etc. */
function isFuzzyNameMatch(query, label) {
  const q = toNorm(query);
  const l = toNorm(label);
  if (!q || !l) return false;

  // direct substring
  if (l.includes(q)) return true;

  // whole-string similarity
  const wholeDist = lev(q, l);
  const wholeSim = 1 - wholeDist / Math.max(q.length, l.length);
  if (wholeSim >= 0.6) return true;

  // per-word similarity (e.g. "selct" ≈ "select")
  const qWords = q.split(" ").filter(Boolean);
  const lWords = l.split(" ").filter(Boolean);
  for (const qw of qWords) {
    if (qw.length < 3) continue;
    for (const lw of lWords) {
      if (lw.length < 3) continue;
      const d = lev(qw, lw);
      const sim = 1 - d / Math.max(qw.length, lw.length);
      if (sim >= 0.7) return true;
    }
  }
  return false;
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

/** Build a URL that respects the deploy base path */
const BASE = (import.meta?.env?.BASE_URL ?? "/");
const csvUrl = (name) => `${BASE}${encodeURI(name)}`.replace(/\/{2,}/g, "/");

/** -------------------- IMAGE FALLBACKS -------------------- */
const FALLBACK_IMAGE_BY_SITE = {
  swiggy:
    "https://restaurantindia.s3.ap-south-1.amazonaws.com/s3fs-public/2020-02/Swiggy.jpg",
  zomato:
    "https://c.ndtvimg.com/2024-06/mr51ho8o_zomato-logo-stock-image_625x300_03_June_24.jpg?im=FeatureCrop,algorithm=dnn,width=545,height=307",
  eazydiner:
    "https://pbs.twimg.com/profile_images/1559453938390294530/zvZbaruY_400x400.jpg",
};

function isUsableImage(val) {
  if (!val) return false;
  const s = String(val).trim();
  if (!s) return false;
  if (/^(na|n\/a|null|undefined|-|image unavailable)$/i.test(s)) return false;
  return true;
}
function resolveImage(siteKey, candidate) {
  const key = String(siteKey || "").toLowerCase();
  const fallback = FALLBACK_IMAGE_BY_SITE[key];
  const usingFallback = !isUsableImage(candidate) && !!fallback;
  return { src: usingFallback ? fallback : candidate, usingFallback };
}
function handleImgError(e, siteKey) {
  const key = String(siteKey || "").toLowerCase();
  const fallback = FALLBACK_IMAGE_BY_SITE[key];
  const el = e.currentTarget;
  if (fallback && el.src !== fallback) {
    el.src = fallback;
    el.classList.add("is-fallback");
  } else {
    el.style.display = "none";
  }
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
  // dropdown data (from allCards.csv ONLY)
  const [creditEntries, setCreditEntries] = useState([]);
  const [debitEntries, setDebitEntries] = useState([]);

  // chip strips (from offer CSVs ONLY — NOT allCards.csv)
  const [chipCC, setChipCC] = useState([]);
  const [chipDC, setChipDC] = useState([]);

  // ui state
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // {type, display, baseNorm}
  const [noMatches, setNoMatches] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // offers
  const [swiggyOffers, setSwiggyOffers] = useState([]);
  const [zomatoOffers, setZomatoOffers] = useState([]);
  const [eazyOffers, setEazyOffers] = useState([]);
  const [permanentOffers, setPermanentOffers] = useState([]);

  // load error flags (to surface why chips may be empty)
  const [offerErrors, setOfferErrors] = useState({
    swiggy: null,
    zomato: null,
    eazy: null,
  });

  // responsive
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 1) Load allCards.csv for dropdown lists ONLY
  useEffect(() => {
    async function loadAllCards() {
      try {
        const url = csvUrl("allCards.csv");
        const res = await axios.get(url, { responseType: "text" });
        const parsed = Papa.parse(res.data, { header: true, skipEmptyLines: true });
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
        setNoMatches(true);
        setSelected(null);
      }
    }
    loadAllCards();
  }, []);

  // 2) Load offer CSVs (ONLY: permanent, swiggy, zomato, eazydiner)
  useEffect(() => {
    async function loadOffers() {
      const files = [
        { name: "Swiggy.csv", setter: setSwiggyOffers, key: "swiggy" },
        { name: "Zomato.csv", setter: setZomatoOffers, key: "zomato" },
        { name: "Eazydiner.csv", setter: setEazyOffers, key: "eazy" },
        { name: "permanent.csv", setter: setPermanentOffers, key: "permanent" },
      ];

      await Promise.all(
        files.map(async (f) => {
          const url = csvUrl(f.name);
          try {
            const res = await axios.get(url, { responseType: "text" });
            const parsed = Papa.parse(res.data, { header: true, skipEmptyLines: true });
            f.setter(parsed.data || []);
            if (f.key !== "permanent") {
              setOfferErrors((prev) => ({ ...prev, [f.key]: null }));
            }
          } catch (e) {
            f.setter([]);
            if (f.key !== "permanent") {
              setOfferErrors((prev) => ({ ...prev, [f.key]: e?.response?.status || "ERR" }));
            }
          }
        })
      );
    }
    loadOffers();
  }, []);

  /** Build chip strips from OFFER CSVs (exclude allCards.csv) */
  useEffect(() => {
    const ccMap = new Map(); // baseNorm -> display
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

    // Offer files only
    harvestRows(swiggyOffers);
    harvestRows(zomatoOffers);
    harvestRows(eazyOffers);

    // Permanent credit cards (credit only)
    for (const o of permanentOffers || []) {
      const nm = firstField(o, LIST_FIELDS.permanentCCName);
      if (nm) {
        const base = brandCanonicalize(getBase(nm));
        const baseNorm = toNorm(base);
        if (baseNorm) ccMap.set(baseNorm, ccMap.get(baseNorm) || base);
      }
    }

    setChipCC(Array.from(ccMap.values()).sort((a, b) => a.localeCompare(b)));
    setChipDC(Array.from(dcMap.values()).sort((a, b) => a.localeCompare(b)));
  }, [swiggyOffers, zomatoOffers, eazyOffers, permanentOffers]);

  /** 🔹 UPDATED search box:
   *  - Fuzzy match for any typo (e.g. "selct")
   *  - "Select" cards boosted to top
   *  - If query mentions dc/debit/debit card → show Debit section first
   */
  const onChangeQuery = (e) => {
    const val = e.target.value;
    setQuery(val);

    const trimmed = val.trim();
    if (!trimmed) {
      setFilteredCards([]);
      setSelected(null);
      setNoMatches(false);
      return;
    }

    const qLower = trimmed.toLowerCase();

    const scored = (arr) =>
      arr
        .map((it) => {
          const baseScore = scoreCandidate(trimmed, it.display);
          const inc = it.display.toLowerCase().includes(qLower);
          const fuzzy = isFuzzyNameMatch(trimmed, it.display);

          let s = baseScore;
          if (inc) s += 2.0;      // strong boost for direct substring
          if (fuzzy) s += 1.5;    // boost for typo-ish matches

          return { it, s, inc, fuzzy };
        })
        .filter(({ s, inc, fuzzy }) => inc || fuzzy || s > 0.3)
        .sort((a, b) => b.s - a.s || a.it.display.localeCompare(b.it.display))
        .slice(0, MAX_SUGGESTIONS)
        .map(({ it }) => it);

    let cc = scored(creditEntries);
    let dc = scored(debitEntries);

    if (!cc.length && !dc.length) {
      setNoMatches(true);
      setSelected(null);
      setFilteredCards([]);
      return;
    }

    /** --- SPECIAL CASE 1: "select credit card" / typo like "selct" → boost Select cards first --- */
    const qNorm = toNorm(trimmed);
    const qWords = qNorm.split(" ").filter(Boolean);

    const hasSelectWord = qWords.some((w) => {
      if (w === "select") return true;
      if (w.length < 3) return false;
      const d = lev(w, "select");
      const sim = 1 - d / Math.max(w.length, "select".length);
      return sim >= 0.7; // "selct", "selec", "slect", etc.
    });

    const isSelectIntent =
      qNorm.includes("select credit card") ||
      qNorm.includes("select card") ||
      hasSelectWord;

    if (isSelectIntent) {
      const reorderBySelect = (arr) => {
        const selectCards = [];
        const others = [];
        arr.forEach((item) => {
          const labelNorm = toNorm(item.display);
          if (labelNorm.includes("select")) selectCards.push(item);
          else others.push(item);
        });
        return [...selectCards, ...others];
      };
      cc = reorderBySelect(cc);
      dc = reorderBySelect(dc);
    }

    /** --- SPECIAL CASE 2: if query hints debit/DC → show Debit section first --- */
    const mentionsDebit =
      qLower.includes("debit card") ||
      qLower.includes("debit cards") ||
      qLower.includes("debit");
    const mentionsDC =
      qLower === "dc" ||
      qLower.startsWith("dc ") ||
      qLower.endsWith(" dc") ||
      qLower.includes(" dc ");

    const wantsDCFirst = mentionsDebit || mentionsDC;

    setNoMatches(false);
    setFilteredCards(
      wantsDCFirst
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
          ]
    );
  };

  const onPick = (entry) => {
    setSelected(entry);
    setQuery(entry.display);
    setFilteredCards([]);
    setNoMatches(false);
  };

  // Chip click → set the dropdown + selected entry
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
      if (matched) {
        out.push({ offer: o, site, variantText: matchedVariant });
      }
    }
    return out;
  }

  // Collect then global-dedup by priority
  const wPermanent = matchesFor(permanentOffers, "permanent", "Permanent");
  const wSwiggy = matchesFor(swiggyOffers, selected?.type === "debit" ? "debit" : "credit", "Swiggy");
  const wZomato = matchesFor(zomatoOffers, selected?.type === "debit" ? "debit" : "credit", "Zomato");
  const wEazy = matchesFor(eazyOffers, selected?.type === "debit" ? "debit" : "credit", "EazyDiner");

  const seen = new Set();
  const dPermanent = selected?.type === "credit" ? dedupWrappers(wPermanent, seen) : []; // permanent for credit only
  const dSwiggy = dedupWrappers(wSwiggy, seen);
  const dZomato = dedupWrappers(wZomato, seen);
  const dEazy = dedupWrappers(wEazy, seen);

  const hasAny = Boolean(dPermanent.length || dSwiggy.length || dZomato.length || dEazy.length);

  /** Offer card UI (with image fallbacks) */
  const OfferCard = ({ wrapper, isPermanent, isRetail, isZomato }) => {
    const [copied, setCopied] = useState(false);

    const o = wrapper.offer;
    const getCI = (obj, key) => {
      if (!obj) return undefined;
      const target = String(key).toLowerCase();
      for (const k of Object.keys(obj)) {
        if (String(k).toLowerCase() === target) return obj[k];
      }
      return undefined;
    };

    let title = firstField(o, LIST_FIELDS.title) || o.Website || "Offer";
    let desc = firstField(o, LIST_FIELDS.desc);
    let image = firstField(o, LIST_FIELDS.image);
    let link = firstField(o, LIST_FIELDS.link);

    // Swiggy/EazyDiner
    if (isRetail) {
      title = getCI(o, "Offer") ?? title;
      desc = getCI(o, "Offer Description") ?? getCI(o, "Description") ?? desc;
      image = getCI(o, "Images") ?? getCI(o, "Image") ?? image;
      link = getCI(o, "Link") ?? link;
    }

    // Zomato
    let couponCode;
    if (isZomato) {
      couponCode = getCI(o, "Coupon Code");
      title = title || "Zomato Offer";
      desc = getCI(o, "Description") ?? desc;
    }

    const showVariantNote =
      VARIANT_NOTE_SITES.has(wrapper.site) &&
      wrapper.variantText &&
      wrapper.variantText.trim().length > 0;

    const permanentBenefit = isPermanent ? firstField(o, LIST_FIELDS.permanentBenefit) : "";

    const onCopy = () => {
      if (!couponCode) return;
      navigator.clipboard?.writeText(String(couponCode)).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    };

    // Decide image + fallback for Swiggy/Zomato/EazyDiner
    const siteKey = String(wrapper.site || "").toLowerCase();
    const wantsFallbackLogic = ["swiggy", "zomato", "eazydiner"].includes(siteKey);
    const { src: imgSrc, usingFallback } = wantsFallbackLogic
      ? resolveImage(siteKey, image)
      : { src: image, usingFallback: false };

    // Zomato coupon-only block still shows (optional) image above
    return (
      <div className="offer-card">
        {imgSrc && (
          <img
            className={`offer-img ${usingFallback ? "is-fallback" : ""}`}
            src={imgSrc}
            alt={title}
            onError={(e) => wantsFallbackLogic && handleImgError(e, siteKey)}
          />
        )}

        <div className="offer-info">
          <h3 className="offer-title">{title}</h3>

          {isPermanent ? (
            <>
              {permanentBenefit && <p className="offer-desc">{permanentBenefit}</p>}
              <p className="inbuilt-note">
                <strong>This is a inbuilt feature of this credit card</strong>
              </p>
            </>
          ) : (
            desc && <p className="offer-desc">{desc}</p>
          )}

          {isZomato && couponCode && (
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
              <button className="btn" onClick={onCopy} aria-label="Copy coupon code" title="Copy coupon code">
                <span role="img" aria-hidden="true">📋</span> Copy
              </button>
              {copied && <span style={{ color: "#1e7145", fontSize: 14 }}>Copied!</span>}
            </div>
          )}

          {showVariantNote && (
            <p className="network-note">
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

  const anyOfferCsvMissing =
    (offerErrors.swiggy || offerErrors.zomato || offerErrors.eazy) !== null;

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>
      {/* Cards-with-offers strip container */}
      {(chipCC.length > 0 || chipDC.length > 0 || anyOfferCsvMissing) && (
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

          {/* Helpful inline note when offer CSVs are missing (why DC may be empty) */}
          {chipDC.length === 0 && anyOfferCsvMissing && (
            <div style={{ margin: "0 0 10px", color: "#b00020", textAlign: "center", fontSize: 13 }}>
              Debit-card chips are empty because one or more offer CSVs were not found:
              {offerErrors.swiggy ? " swiggy.csv" : ""}
              {offerErrors.zomato ? " zomato.csv" : ""}
              {offerErrors.eazy ? " eazydiner.csv" : ""}. Add these files under <code>/public</code>.
            </div>
          )}

          {/* Credit strip */}
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

          {/* Debit strip */}
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
                  style={{
                    padding: "10px",
                    cursor: "pointer",
                    borderBottom: "1px solid #f2f2f2",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#f7f9ff")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {item.display}
                </li>
              )
            )}
          </ul>
        )}
      </div>

      {noMatches && query.trim() && (
        <p style={{ color: "#d32f2f", textAlign: "center", marginTop: 8 }}>
          No matching cards found. Please try a different name.
        </p>
      )}

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
                  <OfferCard key={`sw-${i}`} wrapper={w} isRetail />
                ))}
              </div>
            </div>
          )}

          {!!dZomato.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers On Zomato</h2>
              <div className="offer-grid">
                {dZomato.map((w, i) => (
                  <OfferCard key={`zo-${i}`} wrapper={w} isZomato />
                ))}
              </div>
            </div>
          )}

          {!!dEazy.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Offers On EazyDiner</h2>
              <div className="offer-grid">
                {dEazy.map((w, i) => (
                  <OfferCard key={`ez-${i}`} wrapper={w} isRetail />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selected && !hasAny && !noMatches && (
        <p style={{ color: "#d32f2f", textAlign: "center", marginTop: 10 }}>
          No offer available for this card
        </p>
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
