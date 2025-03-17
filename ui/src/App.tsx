import React, { useState, useEffect, useRef } from "react";
import "./styles.css";
import "./starburst.css";
import Banner from "./components/Banner";
import Marquee from "./components/Marquee";
import LogDisplay from "./components/LogDisplay";

const colors = {
  primaryColor: "#70C7BA",
  primaryDark: "#231F20",
  primaryLight: "#B6B6B6",
  secondaryColor: "#49EACB",
};

const kaspaLogoUrl = "/images/Kaspa-LDSP-Black.png";
const kaspaWalletQrUrl = "/images/KaspiumQRCode.svg"; // Hardcoded QR URL

const WS_URL = "ws://192.168.68.68:8765";

type ScreenType =
    | "welcome"
    | "wallet"
    | "insert-coin"
    | "confirm-amount"
    | "scan-wallet"
    | "processing"
    | "error-page";

const getNextScreen = (currentScreen: ScreenType): ScreenType => {
  switch (currentScreen) {
    case "welcome":
      return "wallet";
    case "wallet":
      return "insert-coin";
    case "insert-coin":
      return "confirm-amount";
    case "confirm-amount":
      return "scan-wallet";
    case "scan-wallet":
      return "processing";
    case "processing":
      return "welcome";
    default:
      return "error-page";
  }
};

const App: React.FC = () => {
  const [screen, setScreen] = useState<ScreenType>("welcome");
  const [connected, setConnected] = useState(false);
  const [inserted_money, setInsertedMoney] = useState<number>(0);
  const [kaspa_price, setKaspaPrice] = useState<number>(0);
  const [usd_to_currency, setUsdToCurrency] = useState<number>(0);
  const [submit_logs, setSubmitLogs] = useState<string[]>([]);
  const [submit_outcome, setSubmitOutcome] = useState(false);
  const [error_log, setErrorLog] = useState<string>("");


  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let reconnectAttempts = 0;

    const connectWebSocket = () => {
      if (socketRef.current) return;

      socketRef.current = new WebSocket(WS_URL);

      socketRef.current.onopen = () => {
        setConnected(true);
        reconnectAttempts = 0;
      };

      socketRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log("received message:", message);

          // Handling "screen-change" message
          if (message.event === "screen-change") {
            setScreen(message.data.screen);
            if (message.data.screen === "welcome"){
              setSubmitLogs([]);
              setErrorLog("");
            }
          }

          // Handling "coin-update" message
          else if (message.event === "coin-update") {
            setInsertedMoney(message.data.total_collected);
          }

          else if (message.event === "exchange-update") {
            setKaspaPrice(Math.round((message.data.kaspa_price + Number.EPSILON) * 1000) / 1000);
            setUsdToCurrency(Math.round((1/(message.data.usd_to_aud) + Number.EPSILON) * 1000) / 1000);
          }
          else if (message.event === "submit-log"){
            setSubmitLogs((prevLogs) => [...prevLogs, message.data.type + " " + message.data.message]);
          }
          else if (message.event === "submit-outcome"){
            setSubmitOutcome(message.data.result);
          }
          else if (message.event === "error-log"){
            setErrorLog(message.data.notification);
          }

        } catch (error) {
          console.error("Error parsing WebSocket message:", event.data);
          console.log("Invalid message data received:", event.data);
        }
      };

      socketRef.current.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        setTimeout(connectWebSocket, Math.min(5000, (reconnectAttempts + 1) * 1000));
        reconnectAttempts++;
      };
    };

    connectWebSocket();
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const statusBar = (
      <div className="status-bar">
        <p>{connected ? "✓ Connected" : "Reconnecting to WebSocket... ♻"}</p>
      </div>
  );

  const handleLogoClick = () => {
    setScreen((prevScreen) => getNextScreen(prevScreen));
  };

  const Screen: React.FC<{
    message: string;
    buttonLabel?: string;
    extraContent?: React.ReactNode;
  }> = React.memo(({ message, buttonLabel, extraContent }) => {

    const moneyRef = useRef<HTMLSpanElement | null>(null);
    const lines = message.split("/n");

    useEffect(() => {
      const target = moneyRef.current;
      if (!target) return;

      // Add the animation class
      target.classList.add("value-changed");

      // Remove it after animation completes
      const timeout = setTimeout(() => {
        target.classList.remove("value-changed");
      }, 2500);

      return () => clearTimeout(timeout); // Cleanup in case the component unmounts
    }, [inserted_money]); // Runs every time inserted_money changes

    return (
        <div className="screen welcome-screen">
          <div className="money welcome-message">
            {inserted_money > 0  &&
            <div className="starburst">
              <span className="text" ref={moneyRef}>${inserted_money}</span>
            </div>}
          </div>
          <img
              src={kaspaLogoUrl}
              alt="Kaspa Logo"
              className="kaspa-logo"
              onClick={handleLogoClick}
          />
          {lines.map((line, index) => (
              <h1 key={index} className="welcome-message">
                {line}
              </h1>
          ))}
          {extraContent && <div className="extra-content">{extraContent}</div>}
          <div className="push-up-a-bit"></div>
          {buttonLabel && (
              <div className="prompt-container">
                <p className="start-prompt">{buttonLabel}</p>
              </div>
          )}
          {statusBar}
        </div>
    );
  });

  return (
      <>
        {/* The Banner component is placed outside the screen change logic */}
        {screen === "welcome" && (
            <div>
              {/*<Banner />*/}
              <Marquee />
              <Screen
                  message="Yo! Welcome to the Kaspa converter. /nTransform your spare change into something valuable!"
                  buttonLabel="Let's get started"
              />
            </div>
        )}
        {screen === "wallet" && (
            <Screen
                message="Got a Kaspa wallet? /nNo? No worries—grab one here before we start!"
                buttonLabel="Got the wallet, let's go!"
                extraContent={<object id="mySvg" type="image/svg+xml" data={kaspaWalletQrUrl}></object>}
            />
        )}
        {screen === "insert-coin" && (
            <Screen message="Feed me your spare coins!/n When you're done, hit the button below." buttonLabel="Go Go Go" />
        )}
        {screen === "confirm-amount" && (
            <Screen
                message={`Sweet! You dropped in $${inserted_money}./nSo that brings us to: ${
                    // Number(usd_to_currency)
                    (
                        Math.round(
                          ((inserted_money * Number(usd_to_currency) / Number(kaspa_price)) + Number.EPSILON) * 10
                        ) 
                     / 10
                    )
                } KASPA`} buttonLabel="Ready to send?" extraContent={<h3>Kaspa price: ${kaspa_price}. &nbsp;USD/AUD Rate: ${usd_to_currency}. </h3>}
            />
        )}
        {screen === "scan-wallet" && (
            <Screen
                message="Point your Kaspa wallet QR code at the scanner. /nLet me read your public address"
                buttonLabel="Need help finding your public address QR code?"
            />
        )}
        {screen === "processing" && (
            <div>
              <Screen
                message="Sending your Kaspa through the blockDAG... almost there..."
                extraContent={<LogDisplay entries={submit_logs} /> }
                buttonLabel="That was great! Let's do it again"
              />

            </div>
        )}
        {screen === "error-page" && (
            <Screen
                message="Uh-oh! Something glitched. Don’t worry, your coins are safe. Try again!"
                buttonLabel="Retry"
                extraContent={<LogDisplay entries={[error_log]} /> }
            />
        )}
      </>
  );
};

export default App;
