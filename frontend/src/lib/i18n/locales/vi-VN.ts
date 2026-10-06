import type { TranslationDict } from "../types";

import ui from "./ui/vi-VN";
import tasks from "./tasks/vi-VN";
import blocklist from "./blocklist/vi-VN";
import api from "./api/vi-VN";
import log from "./log/vi-VN";

const viVN: TranslationDict = {
  ...ui,
  ...tasks,
  ...blocklist,
  ...api,
  ...log,
};

export default viVN;
