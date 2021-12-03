import send from './send';

/**
 * @example
 * // with resolve bind:
 * resolve(succes(body))
 * // withouth resolve bind:
 * success(body)(callback)(response)
 */
export const success = send(200);

/**
 * @param missing name or array of names of the missing parameters
 * * @example
 * // with resolve bind:
 * resolve(error400('onlyMissingParam'))
 * // withouth resolve bind:
 * error400(['missingParam1', 'missingParam2'])(callback)(response)
 */
export const error400 = (missing: string | string[]) => {
  if (missing instanceof Array)
    return send(400)({
      message: `Error: ${missing.join(', ')} parameters not provided`,
      status: 400,
    });

  return send(400)({ message: `Error: ${missing} parameter not provided`, status: 400 });
};

/**
 * @param message message to send within the 403 status http response
 * @example
 * resolve(error404('Forbiden: you are not authorized'))
 */
export const error403 = (message: string) => {
  return send(403)({ message, status: 403 });
};

/**
 * @example
 * // with resolve bind:
 * resolve(error500(err))
 * // withouth resolve bind:
 * error500(err)(callback)(response)
 */
export const error500 = (error: Error) => send(500)({ message: error.message, stack: error.stack, status: 500 });
