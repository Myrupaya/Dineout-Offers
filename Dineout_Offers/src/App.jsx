import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

// Helper function to normalize card names
const normalizeCardName = (name) => {
  if (!name) return '';
  return name.trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\s+/g, ' ');
};

// Helper to extract base card name (remove network variant)
const getBaseCardName = (name) => {
  if (!name) return '';
  return name.replace(/\s*\([^)]*\)$/, '').trim();
};

// Fuzzy matching utility functions
const levenshteinDistance = (a, b) => {
  if (!a || !b) return 100;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
};

const getMatchScore = (query, card) => {
  if (!query || !card) return 0;
  const qWords = query.trim().toLowerCase().split(/\s+/);
  const cWords = card.trim().toLowerCase().split(/\s+/);

  if (card.toLowerCase().includes(query.toLowerCase())) return 100;

  const matchingWords = qWords.filter(qWord =>
    cWords.some(cWord => cWord.includes(qWord))
  ).length;

  const similarity = 1 - (levenshteinDistance(query.toLowerCase(), card.toLowerCase()) /
    Math.max(query.length, card.length));

  return (matchingWords / qWords.length) * 0.7 + similarity * 0.3;
};

const highlightMatch = (text, query) => {
  if (!query.trim()) return text;

  const regex = new RegExp(`(${query.trim().split(/\s+/).map(word =>
    word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');

  return text.split(regex).map((part, i) =>
    regex.test(part) ? <mark key={i}>{part}</mark> : part
  );
};

const CreditCardDropdown = () => {
  const [creditCards, setCreditCards] = useState([]);
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState("");
  const [eazydinerOffers, setEazydinerOffers] = useState([]);
  const [zomatoOffers, setZomatoOffers] = useState([]);
  const [swiggyOffers, setSwiggyOffers] = useState([]);
  const [expandedOfferIndex, setExpandedOfferIndex] = useState({ 
    eazydiner: null, 
    zomato: null, 
    swiggy: null 
  });
  const [showNoCardMessage, setShowNoCardMessage] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      alert("Promo code copied: " + text);
    });
  };

  const getOffersForSelectedCard = (offers) => {
    if (!selectedCard) return [];
    
    return offers.filter((offer) => {
      if (!offer["Eligible Credit Cards"]) return false;
      
      const eligibleCards = offer["Eligible Credit Cards"]
        .split(',')
        .map(card => getBaseCardName(normalizeCardName(card.trim())));
      
      return eligibleCards.includes(selectedCard);
    });
  };

  const selectedEazydinerOffers = getOffersForSelectedCard(eazydinerOffers);
  const selectedZomatoOffers = getOffersForSelectedCard(zomatoOffers);
  const selectedSwiggyOffers = getOffersForSelectedCard(swiggyOffers);

  const toggleOfferDetails = (type, index) => {
    setExpandedOfferIndex((prev) => ({
      ...prev,
      [type]: prev[type] === index ? null : index,
    }));
  };

  const hasAnyOffers = useCallback(() => {
    return (
      selectedEazydinerOffers.length > 0 ||
      selectedZomatoOffers.length > 0 ||
      selectedSwiggyOffers.length > 0
    );
  }, [selectedEazydinerOffers, selectedZomatoOffers, selectedSwiggyOffers]);

  const handleScrollDown = () => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth"
    });
  };

  useEffect(() => {
    const fetchCSVData = async () => {
      try {
        const [eazydinerResponse, zomatoResponse, swiggyResponse, allCardsResponse] = await Promise.all([
          axios.get("/Eazydiner.csv"),
          axios.get("/Zomato.csv"),
          axios.get("/Swiggy.csv"),
          axios.get("/All Cards.csv")
        ]);

        const eazydinerData = Papa.parse(eazydinerResponse.data, { header: true });
        const zomatoData = Papa.parse(zomatoResponse.data, { header: true });
        const swiggyData = Papa.parse(swiggyResponse.data, { header: true });
        const allCardsParsed = Papa.parse(allCardsResponse.data, { header: true });

        setEazydinerOffers(eazydinerData.data);
        setZomatoOffers(zomatoData.data);
        setSwiggyOffers(swiggyData.data);

        const baseCardSet = new Set();

        // Process All Cards CSV
        allCardsParsed.data.forEach(row => {
          if (row["Eligible Credit Cards"]) {
            const baseName = getBaseCardName(normalizeCardName(row["Eligible Credit Cards"]));
            baseCardSet.add(baseName);
          }
        });

        // Process other CSVs
        const processOtherCSV = (data) => {
          data.forEach(row => {
            if (row["Eligible Credit Cards"]) {
              const cards = row["Eligible Credit Cards"].split(',');
              cards.forEach(card => {
                const baseName = getBaseCardName(normalizeCardName(card.trim()));
                baseCardSet.add(baseName);
              });
            }
          });
        };

        processOtherCSV(eazydinerData.data);
        processOtherCSV(zomatoData.data);
        processOtherCSV(swiggyData.data);

        setCreditCards(Array.from(baseCardSet).sort());
      } catch (error) {
        console.error("Error loading CSV data:", error);
      }
    };

    fetchCSVData();
  }, []);

  useEffect(() => {
    setShowScrollButton(selectedCard && hasAnyOffers());
  }, [selectedCard, hasAnyOffers]);

  const handleInputChange = (event) => {
    const value = event.target.value;
    setQuery(value);
    setShowNoCardMessage(false);

    if (typingTimeout) clearTimeout(typingTimeout);

    if (!value) {
      setSelectedCard("");
      setFilteredCards([]);
      return;
    }

    if (selectedCard && value !== selectedCard) {
      setSelectedCard("");
    }

    const scoredCards = creditCards.map(card => ({
      card,
      score: getMatchScore(value, card)
    }))
      .filter(item => item.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const combinedResults = [];
    if (scoredCards.length > 0) {
      combinedResults.push({ type: "heading", label: "Credit Cards" });
      combinedResults.push(...scoredCards.map(item => ({
        type: "credit",
        card: item.card,
        score: item.score
      })));
    }

    setFilteredCards(combinedResults);

    if (combinedResults.length === 0 && value.length > 2) {
      const timeout = setTimeout(() => {
        setShowNoCardMessage(true);
      }, 1000);
      setTypingTimeout(timeout);
    }
  };

  const handleCardSelection = (card) => {
    setSelectedCard(card);
    setQuery(card);
    setFilteredCards([]);
    setExpandedOfferIndex({ eazydiner: null, zomato: null, swiggy: null });
    setShowNoCardMessage(false);
    if (typingTimeout) clearTimeout(typingTimeout);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="App">
      <div className="content-container">
        <div className="creditCardDropdown" style={{ position: "relative", width: "600px", margin: "2px auto", marginTop:"2px" }}>
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder="Type a Credit Card..."
            style={{
              width: "90%",
              padding: "12px",
              fontSize: "16px",
              border: `1px solid ${showNoCardMessage ? 'red' : '#ccc'}`,
              borderRadius: "5px",
            }}
          />
          {filteredCards.length > 0 && (
            <ul
              style={{
                listStyleType: "none",
                padding: "10px",
                margin: 0,
                width: "90%",
                maxHeight: "200px",
                overflowY: "auto",
                border: "1px solid #ccc",
                borderRadius: "5px",
                backgroundColor: "#fff",
                position: "absolute",
                zIndex: 1000,
              }}
            >
              {filteredCards.map((item, index) =>
                item.type === "heading" ? (
                  <li key={index} className="dropdown-heading">
                    <strong>{item.label}</strong>
                  </li>
                ) : (
                  <li
                    key={index}
                    onClick={() => handleCardSelection(item.card)}
                    style={{
                      padding: "10px",
                      cursor: "pointer",
                      borderBottom: index !== filteredCards.length - 1 ? "1px solid #eee" : "none",
                      backgroundColor: item.score > 0.8 ? "#f8fff0" : 
                                      item.score > 0.6 ? "#fff8e1" : "#fff"
                    }}
                    onMouseOver={(e) => (e.target.style.backgroundColor = "#f0f0f0")}
                    onMouseOut={(e) => (e.target.style.backgroundColor = 
                      item.score > 0.8 ? "#f8fff0" : 
                      item.score > 0.6 ? "#fff8e1" : "#fff")}
                  >
                    {highlightMatch(item.card, query)}
                    {item.score < 0.8 && (
                      <span style={{ 
                        float: "right", 
                        color: "#999", 
                        fontSize: "0.8em"
                      }}>
                        Similar
                      </span>
                    )}
                  </li>
                )
              )}
            </ul>
          )}
        </div>

        {showScrollButton && (
          <button 
            onClick={handleScrollDown}
            style={{
              position: "fixed",
              bottom: "350px",
              right: "20px",
              padding: isMobile ? "12px" : "10px 15px",
              backgroundColor: "#1e7145",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: isMobile ? "40px" : "auto",
              height: isMobile ? "40px" : "auto"
            }}
            aria-label="Scroll down"
          >
            {isMobile ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            ) : (
              <span>Scroll Down</span>
            )}
          </button>
        )}

        {showNoCardMessage && (
          <div style={{ textAlign: "center", margin: "40px 0", fontSize: "20px", color: "red", fontWeight: "bold" }}>
            No offers for this card
          </div>
        )}

        {selectedCard && !hasAnyOffers() && !showNoCardMessage && (
          <div style={{ textAlign: "center", margin: "40px 0", fontSize: "20px", color: "#666" }}>
            No offers found for {selectedCard}
          </div>
        )}

        {selectedCard && hasAnyOffers() && (
          <div className="offer-section">
            {selectedEazydinerOffers.length > 0 && (
              <div className="offer-container">
                <h2 style={{ margin: "20px 0" }}>Offers on Eazydiner</h2>
                <div className="offer-row">
                  {selectedEazydinerOffers.map((offer, index) => (
                    <div 
                      key={`eazydiner-${index}`} 
                      className={`offer-card ${expandedOfferIndex.eazydiner === index ? 'expanded' : ''}`}
                    >
                      {network && (
                          <p className="network-note">
                            <strong>Note:</strong> This offer is applicable only on {network} variant
                          </p>
                        )}
                      {offer["Offer"] && <h3>{offer["Offer"]}</h3>}
                      
                      <button 
                        onClick={() => toggleOfferDetails("eazydiner", index)}
                        className={`details-btn ${expandedOfferIndex.eazydiner === index ? "active" : ""}`}
                      >
                        {expandedOfferIndex.eazydiner === index ? "Hide Terms & Conditions" : "Show Terms & Conditions"}
                      </button>
                      
                      <div className={`terms-container ${expandedOfferIndex.eazydiner === index ? 'visible' : ''}`}>
                        <div className="terms-content">
                          {offer["Terms and Conditions"] && <p>{offer["Terms and Conditions"]}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedZomatoOffers.length > 0 && (
              <div className="offer-container">
                <h2>Offers on Zomato</h2>
                <div className="offer-row">
                  {selectedZomatoOffers.map((offer, index) => (
                    <div 
                      key={`zomato-${index}`} 
                      className={`offer-card ${expandedOfferIndex.zomato === index ? 'expanded' : ''}`}
                    >
                      {network && (
                          <p className="network-note">
                            <strong>Note:</strong> This offer is applicable only on {network} variant
                          </p>
                        )}
                      {offer["Offer"] && <h3>{offer["Offer"]}</h3>}
                      
                      {offer["Coupon Code"] && (
                        <div className="promo-code-container">
                          <strong>Coupon Code: </strong>
                          <span className="promo-code">
                            {offer["Coupon Code"]}
                          </span>
                          <div 
                            onClick={() => copyToClipboard(offer["Coupon Code"])}
                            className="copy-button"
                            title="Copy to clipboard"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </div>
                        </div>
                      )}
                      
                      <button 
                        onClick={() => toggleOfferDetails("zomato", index)}
                        className={`details-btn ${expandedOfferIndex.zomato === index ? "active" : ""}`}
                      >
                        {expandedOfferIndex.zomato === index ? "Hide Terms & Conditions" : "Show Terms & Conditions"}
                      </button>
                      
                      <div className={`terms-container ${expandedOfferIndex.zomato === index ? 'visible' : ''}`}>
                        <div className="terms-content">
                          {offer["Terms and Conditions"] && <p>{offer["Terms and Conditions"]}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedSwiggyOffers.length > 0 && (
              <div className="offer-container">
                <h2>Offers on Swiggy</h2>
                <div className="offer-row">
                  {selectedSwiggyOffers.map((offer, index) => (
                    <div 
                      key={`swiggy-${index}`} 
                      className={`offer-card ${expandedOfferIndex.swiggy === index ? 'expanded' : ''}`}
                    >
                      {network && (
                          <p className="network-note">
                            <strong>Note:</strong> This offer is applicable only on {network} variant
                          </p>
                        )}
                      {offer["Offer"] && <h3>{offer["Offer"]}</h3>}
                      
                      {offer["Coupon Code"] && (
                        <div className="promo-code-container">
                          <strong>Coupon Code: </strong>
                          <span className="promo-code">
                            {offer["Coupon Code"]}
                          </span>
                          <div 
                            onClick={() => copyToClipboard(offer["Coupon Code"])}
                            className="copy-button"
                            title="Copy to clipboard"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </div>
                        </div>
                      )}
                      
                      <button 
                        onClick={() => toggleOfferDetails("swiggy", index)}
                        className={`details-btn ${expandedOfferIndex.swiggy === index ? "active" : ""}`}
                      >
                        {expandedOfferIndex.swiggy === index ? "Hide Terms & Conditions" : "Show Terms & Conditions"}
                      </button>
                      
                      <div className={`terms-container ${expandedOfferIndex.swiggy === index ? 'visible' : ''}`}>
                        <div className="terms-content">
                          {offer["Terms and Conditions"] && <p>{offer["Terms and Conditions"]}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {selectedCard && !hasAnyOffers() && !showNoCardMessage ? null : (
        <p className="bottom-disclaimer">
          <h3>Disclaimer</h3> 
          All offers, coupons, and discounts listed on our platform are provided for informational purposes only. 
          We do not guarantee the accuracy, availability, or validity of any offer. Users are advised to verify 
          the terms and conditions with the respective merchants before making any purchase. We are not responsible 
          for any discrepancies, expired offers, or losses arising from the use of these coupons.
        </p>
      )}
    </div>
  );
};

export default CreditCardDropdown;