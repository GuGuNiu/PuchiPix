import type { TranslationDict } from "../types";
import ui from "./ui/pt-BR";
import tasks from "./tasks/pt-BR";
import blocklist from "./blocklist/pt-BR";
import api from "./api/pt-BR";
import log from "./log/pt-BR";
const ptBR: TranslationDict = { ...ui, ...tasks, ...blocklist, ...api, ...log };
export default ptBR;
