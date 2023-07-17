import { INestApplication } from '@nestjs/common';

import { WhatsappConfigService } from '../config.service';
import { SwaggerModuleCore } from '../core/swagger.module.core';
import { BasicAuthFunction } from './auth/basicAuth';

export class SwaggerModulePlus extends SwaggerModuleCore {
  setUpAuth(app: INestApplication) {
    const config = app.get(WhatsappConfigService);
    const usernamePassword = config.getSwaggerUsernamePassword();
    if (usernamePassword) {
      const [username, password] = usernamePassword;
      const authFunction = BasicAuthFunction(username, password, '/api/');
      app.use(authFunction);
    }
  }
}
