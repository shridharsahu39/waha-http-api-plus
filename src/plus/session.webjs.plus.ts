import {
  Client,
  ClientOptions,
  LocalAuth,
  Message,
  MessageMedia,
} from 'whatsapp-web.js';

import { WhatsappSessionWebJSCore } from '../core/session.webjs.core';
import {
  BinaryFile,
  MessageFileRequest,
  MessageImageRequest,
  RemoteFile,
} from '../structures/chatting.dto';

export class WhatsappSessionWebJSPlus extends WhatsappSessionWebJSCore {
  protected buildClient() {
    const clientOptions: ClientOptions = {
      authStrategy: new LocalAuth({
        clientId: this.name,
        dataPath: this.sessionStorage.getFolderPath(this.name),
      }),
      puppeteer: {
        headless: true,
        executablePath: this.getBrowserExecutablePath(),
        args: this.getBrowserArgsForPuppeteer(),
      },
    };
    this.addProxyConfig(clientOptions);
    return new Client(clientOptions);
  }

  private async fileToMedia(file: BinaryFile | RemoteFile) {
    if ('url' in file) {
      const mediaOptions = { unsafeMime: true };
      const media = await MessageMedia.fromUrl(file.url, mediaOptions);
      console.log(media.mimetype);
      media.mimetype = file.mimetype || media.mimetype;
      return media;
    }
    return new MessageMedia(file.mimetype, file.data, file.filename);
  }

  async sendFile(request: MessageFileRequest) {
    const media = await this.fileToMedia(request.file);
    const options = { sendMediaAsDocument: true };
    return this.whatsapp.sendMessage(request.chatId, media, options);
  }

  async sendImage(request: MessageImageRequest) {
    const media = await this.fileToMedia(request.file);
    const options = { media: media };
    return this.whatsapp.sendMessage(request.chatId, request.caption, options);
  }

  async sendVoice(request) {
    const media = await this.fileToMedia(request.file);
    const options = { sendAudioAsVoice: true };
    return this.whatsapp.sendMessage(request.chatId, media, options);
  }

  protected async downloadMedia(message: Message) {
    if (!message.hasMedia) {
      return message;
    }

    this.log.log(
      `The message ${message.id._serialized} has media, downloading it...`,
    );
    return message.downloadMedia().then(async (media: MessageMedia) => {
      this.log.verbose(
        `Writing file from the message ${message.id._serialized}...`,
      );
      if (!media) {
        this.log.log(`No media found for ${message.id._serialized}.`);
        // @ts-ignore
        message.mediaUrl = null;
        return message;
      }
      const buffer = Buffer.from(media.data, 'base64');
      const url = await this.storage.save(
        message.id._serialized,
        media.mimetype,
        buffer,
      );
      this.log.log(
        `The file from ${message.id._serialized} has been saved to ${url}`,
      );

      // @ts-ignore
      message.mediaUrl = url;
      return message;
    });
  }
}
