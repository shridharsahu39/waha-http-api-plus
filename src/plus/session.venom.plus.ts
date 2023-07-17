import { create, CreateConfig, Message } from 'venom-bot';

import { WhatsappSessionVenomCore } from '../core/session.venom.core';

export class WhatsappSessionVenomPlus extends WhatsappSessionVenomCore {
  protected buildClient() {
    const venomOptions: CreateConfig =
      // Keep this options in sync with core
      {
        headless: true,
        devtools: false,
        debug: false,
        logQR: true,
        browserArgs: this.getBrowserArgsForPuppeteer(),
        autoClose: 60000,
        puppeteerOptions: {},
        folderNameToken: this.sessionStorage.engine,
        mkdirFolderToken: this.sessionStorage.sessionsFolder,
      };
    this.addProxyConfig(venomOptions);
    return create(this.name, this.getCatchQR(), undefined, venomOptions);
  }
  protected async downloadAndDecryptMedia(message: Message) {
    if (!message.isMMS || !message.isMedia) {
      return message;
    }

    this.log.log(`The message ${message.id} has media, downloading it...`);
    return this.whatsapp.decryptFile(message).then(async (buffer) => {
      this.log.verbose(`Writing file from the message ${message.id}...`);
      const url = await this.storage.save(message.id, message.mimetype, buffer);
      this.log.log(`The file from ${message.id} has been saved to ${url}`);

      // @ts-ignore
      message.mediaUrl = url;
      return message;
    });
  }
}
