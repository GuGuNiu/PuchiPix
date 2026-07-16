import type { TranslationDict } from "../types";

import ui from "./ui/zh-CN";
import tasks from "./tasks/zh-CN";
import blocklist from "./blocklist/zh-CN";
import api from "./api/zh-CN";
import log from "./log/zh-CN";

const zhCN: TranslationDict = {
  ...ui,
  ...tasks,
  ...blocklist,
  ...api,
  ...log,
};

export default zhCN;
