import type { TranslationDict } from "../types";

import ui from "./ui/en-US";
import tasks from "./tasks/en-US";
import blocklist from "./blocklist/en-US";
import api from "./api/en-US";
import log from "./log/en-US";

const enUS: TranslationDict = {
  ...ui,
  ...tasks,
  ...blocklist,
  ...api,
  ...log,
};

export default enUS;
