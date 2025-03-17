import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const rootElement = document.getElementById("root")!;
const root = ReactDOM.createRoot(rootElement);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <App />
);
