// Banner Component
import React, {useEffect, useState} from "react";
import "./Banner.css"; // Import the styles

const Banner: React.FC = React.memo(() => {
    const [message, setMessage] = useState<string>("");
    const [animate, setAnimate] = useState<boolean>(false);

    const idleMessages = [
        "Convert your spare change into Kaspa!",
        "Current exchange rate: 1 AUD = XX Kaspa",
        "Press the button to start!",
    ];

    useEffect(() => {
        let currentIndex = 0;

        const interval = setInterval(() => {
            setAnimate(false); // Reset animation
            setTimeout(() => {
                console.log("New message:", idleMessages[currentIndex]);
                setMessage(idleMessages[currentIndex]);
                setAnimate(true); // Trigger animation
                currentIndex = (currentIndex + 1) % idleMessages.length;
            }, 200); // Short delay before text change
        }, 3000);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="banner">
      <span className={`animated-text ${animate ? "pop-out" : ""}`}>
        {message}
      </span>
        </div>
    );
});

export default Banner;
