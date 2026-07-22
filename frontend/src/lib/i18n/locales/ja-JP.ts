import type { TranslationDict } from "../types";

import ui from "./ui/ja-JP";
import tasks from "./tasks/ja-JP";
import blocklist from "./blocklist/ja-JP";
import api from "./api/ja-JP";
import log from "./log/ja-JP";

const jaJP: TranslationDict = {
  ...ui,
  ...tasks,
  ...blocklist,
  ...api,
  ...log,
};

export default jaJP;
