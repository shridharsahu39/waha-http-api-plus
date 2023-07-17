import { downloadMediaMessage } from '@adiwajshing/baileys';
import { UnprocessableEntityException } from '@nestjs/common';

import { WhatsappSessionNoWebCore } from '../core/session.noweb.core';
import {
  BinaryFile,
  MessageFileRequest,
  MessageImageRequest,
  MessageVoiceRequest,
  RemoteFile,
} from '../structures/chatting.dto';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logger = require('pino')();

export class WhatsappSessionNoWebPlus extends WhatsappSessionNoWebCore {
  fileToMessage(
    file: RemoteFile | BinaryFile,
    type,
    caption = '',
    filename = undefined,
  ) {
    if (!('url' in file || 'data' in file)) {
      throw new UnprocessableEntityException(
        'Either file.url or file.data must be specified.',
      );
    }

    if ('url' in file) {
      return {
        [type]: { url: file.url },
        caption: caption,
        mimetype: file.mimetype,
        filename: filename,
        ptt: type === 'audio',
      };
    } else if ('data' in file) {
      return {
        [type]: Buffer.from(file.data, 'base64'),
        mimetype: file.mimetype,
        caption: caption,
        filename: filename,
        ptt: type === 'audio',
      };
    }
  }

  sendImage(request: MessageImageRequest) {
    const message = this.fileToMessage(request.file, 'image', request.caption);
    return this.sock.sendMessage(request.chatId, message);
  }

  sendFile(request: MessageFileRequest) {
    const message = this.fileToMessage(
      request.file,
      'document',
      request.caption,
    );
    return this.sock.sendMessage(request.chatId, message);
  }

  sendVoice(request: MessageVoiceRequest) {
    const message = this.fileToMessage(request.file, 'audio');
    return this.sock.sendMessage(request.chatId, message);
  }

  protected async downloadMedia(message) {
    const messageType = Object.keys(message.message)[0];
    const hasMedia =
      messageType === 'imageMessage' ||
      messageType == 'audioMessage' ||
      messageType == 'videoMessage';
    if (!hasMedia) return message;

    const mimetype = message.message[messageType].mimetype;
    this.log.log(`The message ${message.key.id} has media, downloading it...`);
    // download the message
    await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger: logger,
        reuploadRequest: this.sock.updateMediaMessage,
      },
    ).then(async (buffer: Buffer) => {
      this.log.verbose(`Writing file from the message ${message.key.id}...`);
      const url = await this.storage.save(message.key.id, mimetype, buffer);
      this.log.log(`The file from ${message.key.id} has been saved to ${url}`);
      message.mediaUrl = url;
    });
    return message;
  }
}
