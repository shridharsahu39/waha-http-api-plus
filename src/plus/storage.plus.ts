import fs = require('fs');
import del = require('del');
import { ConsoleLogger } from '@nestjs/common';
import crypto from 'crypto';
import * as path from 'path';
import { promisify } from 'util';

import { MediaStorage } from '../core/abc/storage.abc';
import { SessionStorageCore } from '../core/storage.core';
import { SECOND } from '../structures/enums.dto';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mime = require('mime-types');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FileType = require('file-type');
const writeFileAsync = promisify(fs.writeFile);

export class MediaStoragePlus implements MediaStorage {
  private readonly lifetime: number;

  constructor(
    protected log: ConsoleLogger,
    private filesFolder,
    private baseUrl,
    private lifetimeSeconds,
    private mimetypes,
  ) {
    this.lifetime = lifetimeSeconds * SECOND;
  }

  /**
   *  Check that we need to download files with the mimetype
   */
  private needToDownload(mimetype) {
    // No specific mimetypes provided - always download
    if (!this.mimetypes) {
      return true;
    }
    // Found "right" mimetype in the list of allowed mimetypes  - download it
    return this.mimetypes.some((type) => mimetype.startsWith(type));
  }

  public async save(messageId, mimetype, buffer): Promise<string> {
    if (!mimetype) {
      mimetype = (await FileType.fromBuffer(buffer)).mime;
    }

    if (!this.needToDownload(mimetype)) {
      this.log.log(`The message ${messageId} has ${mimetype} media, skip it.`);
      return '';
    }

    const filename = `${messageId}.${mime.extension(mimetype)}`;
    const filepath = path.resolve(`${this.filesFolder}/${filename}`);
    await writeFileAsync(filepath, buffer);
    this.postponeRemoval(filepath);
    return this.baseUrl + filename;
  }

  private postponeRemoval(filepath: string) {
    setTimeout(
      () =>
        fs.unlink(filepath, () => {
          this.log.log(`File ${filepath} was removed`);
        }),
      this.lifetime,
    );
  }

  purge() {
    if (fs.existsSync(this.filesFolder)) {
      del([`${this.filesFolder}/*`], { force: true }).then((paths) => {
        if (paths.length === 0) {
          return;
        }
        this.log.log('Deleted files and directories:\n', paths.join('\n'));
      });
    } else {
      fs.mkdirSync(this.filesFolder);
      this.log.log(`Directory '${this.filesFolder}' created from scratch`);
    }
  }
}

export class SessionStoragePlus extends SessionStorageCore {
  constructor(engine: string) {
    super(engine);
    this.sessionsFolder = './.sessions';
  }
  getFolderPath(name: string): string {
    return path.join(this.engineFolder, name);
  }
}
