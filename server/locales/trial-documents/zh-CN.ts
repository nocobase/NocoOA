import type { LocaleResource } from '@nocobase/i18n';
import type enUS from './en-US.js';
const zhCN: LocaleResource<typeof enUS> = {
  pdf: 'OA虚构试用文件，仅用于演示，不是真实发票',
  template: 'OA虚构试用模板，仅用于功能演示。编号：{d.number}',
};
export default zhCN;
