import type { TranslationDict } from "../types";

import ui from "./ui/ru-RU";
import tasks from "./tasks/ru-RU";
import blocklist from "./blocklist/ru-RU";
import api from "./api/ru-RU";
import log from "./log/ru-RU";

const ruRU: TranslationDict = {
  ...ui,
  ...tasks,
  ...blocklist,
  ...api,
  ...log,
};

export default ruRU;
