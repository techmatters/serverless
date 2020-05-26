import send from './send';

export const success = send(200);

/**
 * @param missing name or names of the missing parameters
 */
export const error400 = (missing: string | string[]) => {
  if (missing instanceof Array)
    return send(400)({
      message: `Error: ${missing.join(', ')} parameters not provided`,
      status: 400,
    });

  return send(400)({ message: `Error: ${missing} parameter not provided`, status: 400 });
};

export const error500 = send(500);
