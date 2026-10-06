import type { TranslationDict } from "../types";

import ui from "./ui/de-DE";
import tasks from "./tasks/de-DE";
import blocklist from "./blocklist/de-DE";
import api from "./api/de-DE";
import log from "./log/de-DE";

const deDE: TranslationDict = {
  ...ui,
  ...tasks,
  ...blocklist,
  ...api,
  ...log,
};

export default deDE;
