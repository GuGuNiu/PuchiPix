﻿import type { TranslationDict } from "../types";

import ui from "./ui/zh-TW";
import tasks from "./tasks/zh-TW";
import blocklist from "./blocklist/zh-TW";
import api from "./api/zh-TW";
import log from "./log/zh-TW";

const zhTW: TranslationDict = {
  ...ui,
  ...tasks,
  ...blocklist,
  ...api,
  ...log,
};

export default zhTW;
