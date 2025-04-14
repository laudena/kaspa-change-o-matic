import { useState, useEffect } from "react";
import "./LogDisplay.css"; // Import the CSS file

export default function LogDisplay({ entries }: { entries: string[] }) {
    const [logs, setLogs] = useState<string[]>([]);

    useEffect(() => {
        if (!entries || !Array.isArray(entries)) return;

        setLogs((prevLogs) => {
            const newLogs = entries.filter((entry) => !prevLogs.includes(entry));
            return [...prevLogs, ...newLogs];
        });
    }, [entries]);

    // Check if the last log entry starts with "SUCCESS"
    const lastLog = logs[logs.length - 1] || "";
    const showSubmitted = lastLog.startsWith("SUCCESS");

    return (
        <div className="log-container">
            {logs.map((log, index) => (
                <div key={index} className="log-entry">
                    {log}
                </div>
            ))}

            {showSubmitted && (
                <div className="submitted-message">
                    Submitted!
                </div>
            )}
        </div>
    );
}
