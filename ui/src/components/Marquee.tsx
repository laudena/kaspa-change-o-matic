import React, { useState, useEffect } from "react";
import "./Marquee.css"

const Marquee: React.FC = React.memo(() => {
    const [message, setMessage] = useState<string>("");
    const idleMessages=
        "\u00A0\u00A0\u00A0\u00A0 • \u00A0\u00A0\u00A0\u00A0" +
        "Convert your spare change into Kaspa! \u00A0\u00A0\u00A0\u00A0 • \u00A0\u00A0\u00A0\u00A0" +
        "Market rate, no commission \u00A0\u00A0\u00A0\u00A0 • \u00A0\u00A0\u00A0\u00A0" +
        "Fiat coin in - Kaspa coin out \u00A0\u00A0\u00A0\u00A0 • \u00A0\u00A0\u00A0\u00A0" +
        "Press the button to start!";

    return (
        <div className="marquee-container">
            <div className="marquee">
                <span>{idleMessages}</span>
                <span>{idleMessages}</span>
            </div>
        </div>
    );
});

export default Marquee;
