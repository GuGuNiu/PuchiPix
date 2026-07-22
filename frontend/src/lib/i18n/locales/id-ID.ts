import type { TranslationDict } from "../types";
import ui from "./ui/id-ID";
import tasks from "./tasks/id-ID";
import blocklist from "./blocklist/id-ID";
import api from "./api/id-ID";
import log from "./log/id-ID";
const idID: TranslationDict = { ...ui, ...tasks, ...blocklist, ...api, ...log };
export default idID;
