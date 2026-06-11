import Alpine from "alpinejs";
import "./index.css";
import { marketplace } from "./store";

Alpine.data("marketplace", marketplace);
window.Alpine = Alpine;
Alpine.start();
