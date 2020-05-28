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
 * @example
 * // with resolve bind:
 * resolve(error500(err))
 * // withouth resolve bind:
 * error500(err)(callback)(response)
 */
export const error500 = send(500);
