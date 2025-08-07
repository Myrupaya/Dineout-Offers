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

// Helper to extract network variant
const getNetworkVariant = (name) => {
  if (!name) return '';
  const match = name.match(/\(([^)]+)\)$/);
  return match ? match[1] : '';
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
  const [pvrOffers, setPvrOffers] = useState([]);
  const [bookMyShowOffers, setBookMyShowOffers] = useState([]);
  const [paytmDistrictOffers, setPaytmDistrictOffers] = useState([]);
  const [movieBenefits, setMovieBenefits] = useState([]);
  const [expandedOfferIndex, setExpandedOfferIndex] = useState({ pvr: null, bms: null, paytm: null });
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
      const offerCardName = offer["Credit Card Name"] ? normalizeCardName(offer["Credit Card Name"]) : "";
      const offerBaseName = getBaseCardName(offerCardName);
      return offerBaseName.toLowerCase() === selectedCard.toLowerCase();
    });
  };

  const getMovieBenefitsForSelectedCard = () => {
    if (!selectedCard) return [];
    return movieBenefits.filter((offer) => {
      const offerCardName = offer["Credit Card Name"] ? normalizeCardName(offer["Credit Card Name"]) : "";
      const offerBaseName = getBaseCardName(offerCardName);
      return offerBaseName.toLowerCase() === selectedCard.toLowerCase();
    });
  };

  const selectedPvrOffers = getOffersForSelectedCard(pvrOffers);
  const selectedBookMyShowOffers = getOffersForSelectedCard(bookMyShowOffers);
  const selectedPaytmDistrictOffers = getOffersForSelectedCard(paytmDistrictOffers);
  const selectedMovieBenefits = getMovieBenefitsForSelectedCard();

  const toggleOfferDetails = (type, index) => {
    setExpandedOfferIndex((prev) => ({
      ...prev,
      [type]: prev[type] === index ? null : index,
    }));
  };

  const hasAnyOffers = useCallback(() => {
    return (
      selectedPvrOffers.length > 0 ||
      selectedBookMyShowOffers.length > 0 ||
      selectedPaytmDistrictOffers.length > 0 ||
      selectedMovieBenefits.length > 0
    );
  }, [
    selectedPvrOffers,
    selectedBookMyShowOffers,
    selectedPaytmDistrictOffers,
    selectedMovieBenefits,
  ]);

  const handleScrollDown = () => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth"
    });
  };

  useEffect(() => {
    const fetchCSVData = async () => {
      try {
        const [pvrResponse, bmsResponse, paytmResponse, benefitsResponse, allCardsResponse] = await Promise.all([
          axios.get("/PVR.csv"),
          axios.get("/Bookmyshow.csv"),
          axios.get("/Paytm and District.csv"),
          axios.get("/Permanent offers.csv"),
          axios.get("/All Cards.csv")
        ]);

        const pvrData = Papa.parse(pvrResponse.data, { header: true });
        const bmsData = Papa.parse(bmsResponse.data, { header: true });
        const paytmData = Papa.parse(paytmResponse.data, { header: true });
        const benefitsData = Papa.parse(benefitsResponse.data, { header: true });
        const allCardsParsed = Papa.parse(allCardsResponse.data, { header: true });

        setPvrOffers(pvrData.data);
        setBookMyShowOffers(bmsData.data);
        setPaytmDistrictOffers(paytmData.data);
        setMovieBenefits(benefitsData.data);

        const baseCardSet = new Set();

        const processCSV = (data) => {
          data.forEach(row => {
            if (row["Credit Card Name"]) {
              const baseName = getBaseCardName(normalizeCardName(row["Credit Card Name"]));
              baseCardSet.add(baseName);
            }
          });
        };

        processCSV(allCardsParsed.data);
        processCSV(pvrData.data);
        processCSV(bmsData.data);
        processCSV(paytmData.data);
        processCSV(benefitsData.data);

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
    setExpandedOfferIndex({ pvr: null, bms: null, paytm: null });
    setShowNoCardMessage(false);
    if (typingTimeout) clearTimeout(typingTimeout);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ... rest of your JSX rendering (same as your original) ...

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
            {selectedMovieBenefits.length > 0 && (
              <div className="offer-container">
                <h2 style={{ margin: "20px 0" }}>Permanent Offers</h2>
                <div className="offer-row">
                  {selectedMovieBenefits.map((benefit, index) => {
                    const cardName = normalizeCardName(benefit["Credit Card Name"] || "");
                    const network = getNetworkVariant(cardName);
                    
                    return (
                      <div key={`benefit-${index}`} className="offer-card">
                        {benefit.image && (
                          <img 
                            src={benefit.image} 
                            alt={cardName || "Card Offer"} 
                            className="benefit-image"
                          />
                        )}
                        
                        {benefit["Movie Benefit"] && <p><strong>Benefit:</strong> {benefit["Movie Benefit"]}</p>}
                        {network && (
                          <p className="network-note">
                            <strong>Note:</strong> This benefit is applicable only on {network} variant
                          </p>
                        )}
                        <p> <strong> This is a inbuilt feature of this credit card </strong></p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedPvrOffers.length > 0 && (
              <div className="offer-container">
                <h2>Offers on both PVR and INOX</h2>
                <div className="offer-row">
                  {selectedPvrOffers.map((offer, index) => {
                    const cardName = normalizeCardName(offer["Credit Card Name"] || "");
                    const network = getNetworkVariant(cardName);
                    
                    return (
                      <div 
                        key={`pvr-${index}`} 
                        className={`offer-card ${expandedOfferIndex.pvr === index ? 'expanded' : ''}`}
                      >
                        {offer["Image URL"] && (
                          <img 
                            src={offer["Image URL"]} 
                            alt={offer["Offer Title"] || "PVR Offer"} 
                            className="offer-image"
                          />
                        )}
                        <h3>{offer["Offer Title"] || "PVR Offer"}</h3>
                        {network && (
                          <p className="network-note">
                            <strong>Note:</strong> This offer is applicable only on {network} variant
                          </p>
                        )}
                        {offer["Validity Date"] && <p><strong>Validity:</strong> {offer["Validity Date"]}</p>}
                        {offer["Coupn Code"] && (
                          <p>
                            <span role="img" aria-label="important" style={{ marginRight: "5px" }}>⚠️</span>
                            <strong>Important:</strong> {offer["Coupn Code"]}
                          </p>
                        )}
                        
                        <button 
                          onClick={() => toggleOfferDetails("pvr", index)}
                          className={`details-btn ${expandedOfferIndex.pvr === index ? "active" : ""}`}
                        >
                          {expandedOfferIndex.pvr === index ? "Hide Terms & Conditions" : "Show Terms & Conditions"}
                        </button>
                        
                        <div className={`terms-container ${expandedOfferIndex.pvr === index ? 'visible' : ''}`}>
                          <div className="terms-content">
                            <p>{offer["Terms and Conditions"]}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedBookMyShowOffers.length > 0 && (
              <div className="offer-container">
                <h2>Offers on BookMyShow</h2>
                <div className="offer-row">
                  {selectedBookMyShowOffers.map((offer, index) => {
                    const cardName = normalizeCardName(offer["Credit Card Name"] || "");
                    const network = getNetworkVariant(cardName);
                    
                    return (
                      <div 
                        key={`bms-${index}`} 
                        className="offer-card"
                      >
                        {offer["Offer Image Link"] && (
                          <img 
                            src={offer["Offer Image Link"]} 
                            alt={"BookMyShow Offer"} 
                            className="offer-image"
                          />
                        )}
                        
                        {offer["Offer Description"] && <p><strong>Description:</strong> {offer["Offer Description"]}</p>}
                        {offer["Validity of Offer"] && <p><strong>Validity:</strong> {offer["Validity of Offer"]}</p>}
                        {network && (
                          <p className="network-note">
                            <strong>Note:</strong> This offer is applicable only on {network} variant
                          </p>
                        )}
                        {offer["Offer Link"] && (
                          <a 
                            href={offer["Offer Link"]} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="offer-link"
                          >
                            <button className="view-details-btn">
                              Click for more details
                            </button>
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedPaytmDistrictOffers.length > 0 && (
              <div className="offer-container">
                <h2>Offers on Paytm and District</h2>
                <div className="offer-row">
                  {selectedPaytmDistrictOffers.map((offer, index) => {
                    const cardName = normalizeCardName(offer["Credit Card Name"] || "");
                    const network = getNetworkVariant(cardName);
                    
                    return (
                      <div 
                        key={`paytm-${index}`} 
                        className={`offer-card ${expandedOfferIndex.paytm === index ? 'expanded' : ''}`}
                      >
                        {offer["Offer Image Link"] && (
                          <img 
                            src={offer["Offer Image Link"]} 
                            alt={"Paytm & District Offer"} 
                            className="offer-image"
                          />
                        )}
                        <h3>{offer["Offer title"] || "Paytm & District Offer"}</h3>
                        {network && (
                          <p className="network-note">
                            <strong>Note:</strong> This offer is applicable only on {network} variant
                          </p>
                        )}
                        {offer["Offer description"] && <p><strong>Description:</strong> {offer["Offer description"]}</p>}
                        
                        {offer["Promo code"] && (
                          <div className="promo-code-container">
                            <strong>Promo Code: </strong>
                            <span className="promo-code">
                              {offer["Promo code"]}
                            </span>
                            <div 
                              onClick={() => copyToClipboard(offer["Promo code"])}
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
                          onClick={() => toggleOfferDetails("paytm", index)}
                          className={`details-btn ${expandedOfferIndex.paytm === index ? "active" : ""}`}
                        >
                          {expandedOfferIndex.paytm === index ? "Hide Terms & Conditions" : "Show Terms & Conditions"}
                        </button>
                        
                        <div className={`terms-container ${expandedOfferIndex.paytm === index ? 'visible' : ''}`}>
                          <div className="terms-content">
                            <p>{offer["Offer details"]}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                     
                </div>
                
              </div>
              
            )}
            
          </div>
          
        )}
     
      </div>
       {selectedCard && !hasAnyOffers() && !showNoCardMessage ? null : (
        <p className="bottom-disclaimer"> <h3>Disclaimer</h3> All offers, coupons, and discounts listed on our platform are provided for informational purposes only. We do not guarantee the accuracy, availability, or validity of any offer. Users are advised to verify the terms and conditions with the respective merchants before making any purchase. We are not responsible for any discrepancies, expired offers, or losses arising from the use of these coupons.</p>
     )}
    </div>
  );
};

export default CreditCardDropdown;