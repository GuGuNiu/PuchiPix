import type { TranslationDict } from "../types";
import ui from "./ui/fr-FR";
import tasks from "./tasks/fr-FR";
import blocklist from "./blocklist/fr-FR";
import api from "./api/fr-FR";
import log from "./log/fr-FR";
const frFR: TranslationDict = { ...ui, ...tasks, ...blocklist, ...api, ...log };
export default frFR;
