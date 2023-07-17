import { ConsoleLogger, Injectable, NotFoundException } from '@nestjs/common';
import * as lodash from 'lodash';
import { getProxyConfig } from 'src/core/helpers.proxy';

import { WhatsappConfigService } from '../config.service';
import { SessionManager } from '../core/abc/manager.abc';
import {
  SessionParams,
  WAHAInternalEvent,
  WhatsappSession,
} from '../core/abc/session.abc';
import { WAHAEngine, WAHASessionStatus } from '../structures/enums.dto';
import {
  ProxyConfig,
  SessionConfig,
  SessionDTO,
  SessionLogoutRequest,
  SessionStartRequest,
  SessionStopRequest,
} from '../structures/sessions.dto';
import { WebhookConfig } from '../structures/webhooks.dto';
import { WhatsappSessionNoWebPlus } from './session.noweb.plus';
import { WhatsappSessionVenomPlus } from './session.venom.plus';
import { WhatsappSessionWebJSPlus } from './session.webjs.plus';
import { MediaStoragePlus, SessionStoragePlus } from './storage.plus';
import { WebhookConductorPlus } from './webhooks.plus';

@Injectable()
export class SessionManagerPlus extends SessionManager {
  private readonly sessions: Record<string, WhatsappSession>;

  // @ts-ignore
  protected MediaStorageClass = MediaStoragePlus;
  // @ts-ignore
  protected WebhookConductorClass = WebhookConductorPlus;
  protected readonly EngineClass: typeof WhatsappSession;

  constructor(
    private config: WhatsappConfigService,
    private log: ConsoleLogger,
  ) {
    super();
    this.log.setContext('SessionManager');
    this.sessions = {};
    const engineName = this.config.getDefaultEngineName();
    this.EngineClass = this.getEngine(engineName);
    this.sessionStorage = new SessionStoragePlus(engineName.toLowerCase());

    this.clearStorage();
    this.restartStoppedSessions();
    this.startPredefinedSessions();
  }

  protected async restartStoppedSessions() {
    if (!this.config.shouldRestartAllSessions) {
      return;
    }

    await this.sessionStorage.init();
    const stoppedSessions = await this.sessionStorage.getAll();

    const promises = stoppedSessions.map(async (sessionName) => {
      this.log.log(`Restarting STOPPED session - ${sessionName}...`);
      const config = await this.sessionStorage.configRepository.get(
        sessionName,
      );
      return this.start({ name: sessionName, config: config });
    });
    await Promise.all(promises);
  }

  protected async startPredefinedSessions() {
    const startSessions = this.config.startSessions;
    const promises = startSessions.map(async (sessionName) => {
      // Do not start already started session
      if (this.sessions[sessionName]) {
        return;
      }
      const config = await this.sessionStorage.configRepository.get(
        sessionName,
      );
      return this.start({ name: sessionName, config: config });
    });
    await Promise.all(promises);
  }

  protected getEngine(engine: WAHAEngine): typeof WhatsappSession {
    if (engine === WAHAEngine.WEBJS) {
      return WhatsappSessionWebJSPlus;
    } else if (engine === WAHAEngine.VENOM) {
      return WhatsappSessionVenomPlus;
    } else if (engine === WAHAEngine.NOWEB) {
      return WhatsappSessionNoWebPlus;
    } else {
      throw new NotFoundException(`Unknown whatsapp engine '${engine}'.`);
    }
  }

  async onApplicationShutdown(signal?: string) {
    this.log.log('Stop all sessions...');
    for (const name of Object.keys(this.sessions)) {
      await this.stop({ name: name, logout: false });
    }
  }

  private clearStorage() {
    /* We need to clear the local storage just once */
    const storage = new this.MediaStorageClass(
      new ConsoleLogger(`Storage`),
      this.config.filesFolder,
      this.config.filesURL,
      this.config.filesLifetime,
      this.config.mimetypes,
    );
    storage.purge();
  }

  //
  // API Methods
  //
  async start(request: SessionStartRequest) {
    const name = request.name;

    this.log.log(`'${name}' - starting session...`);
    const log = new ConsoleLogger(`WhatsappSession - ${name}`);
    const storage = new this.MediaStorageClass(
      new ConsoleLogger(`Storage - ${name}`),
      this.config.filesFolder,
      this.config.filesURL,
      this.config.filesLifetime,
      this.config.mimetypes,
    );
    const webhookLog = new ConsoleLogger(`Webhook - ${name}`);
    const webhook = new this.WebhookConductorClass(webhookLog);

    const proxyConfig = this.getProxyConfig(request);
    const sessionConfig: SessionParams = {
      name,
      storage,
      log,
      sessionStorage: this.sessionStorage,
      proxyConfig: proxyConfig,
      sessionConfig: request.config,
    };
    // @ts-ignore
    const session = new this.EngineClass(sessionConfig);
    this.sessions[name] = session;

    // configure webhooks
    const webhooks = this.getWebhooks(request);
    session.events.on(WAHAInternalEvent.engine_start, () =>
      webhook.configure(session, webhooks),
    );

    // start session
    await session.start();
    return {
      name: session.name,
      status: session.status,
      config: session.sessionConfig,
    };
  }

  /**
   * Combine per session and global webhooks
   */
  private getWebhooks(request: SessionStartRequest) {
    let webhooks: WebhookConfig[] = [];
    if (request.config?.webhooks) {
      webhooks = webhooks.concat(request.config.webhooks);
    }
    const globalWebhookConfig = this.config.getWebhookConfig();
    webhooks.push(globalWebhookConfig);
    return webhooks;
  }

  /**
   * Get either session's or global proxy if defined
   */
  protected getProxyConfig(
    request: SessionStartRequest,
  ): ProxyConfig | undefined {
    if (request.config.proxy) {
      return request.config.proxy;
    }
    return getProxyConfig(this.config, this.sessions, request.name);
  }

  async stop(request: SessionStopRequest) {
    const name = request.name;
    this.log.log(`Stopping ${name} session...`);
    const session = this.getSession(name);
    await session.stop();
    this.log.log(`"${name}" has been stopped.`);
    delete this.sessions[name];
  }

  async logout(request: SessionLogoutRequest) {
    await this.sessionStorage.clean(request.name);
  }

  getSession(name: string, error = true): WhatsappSession {
    const session = this.sessions[name];
    if (!session) {
      if (error) {
        throw new NotFoundException(
          `We didn't find a session with name '${name}'. Please start it first by using POST /sessions/start request`,
        );
      }
      return;
    }
    return session;
  }

  async getSessions(all): Promise<SessionDTO[]> {
    let sessionNames = Object.keys(this.sessions);
    if (all) {
      const stoppedSession = await this.sessionStorage.getAll();
      sessionNames = lodash.union(sessionNames, stoppedSession);
    }

    const sessions = sessionNames.map(async (sessionName) => {
      const status =
        this.sessions[sessionName]?.status || WAHASessionStatus.STOPPED;
      let sessionConfig: SessionConfig;
      if (status != WAHASessionStatus.STOPPED) {
        sessionConfig = this.sessions[sessionName].sessionConfig;
      } else {
        sessionConfig = await this.sessionStorage.configRepository.get(
          sessionName,
        );
      }
      return {
        name: sessionName,
        status: status,
        config: sessionConfig,
      };
    });
    return await Promise.all(sessions);
  }
}
