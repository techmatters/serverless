export class CustomError extends Error {
  channelType: string;

  constructor(message: string, channelType: string) {
    // Call the constructor of the base class (Error)
    super(message);

    // Set the custom property
    this.channelType = channelType;

    // Set the prototype explicitly to ensure proper inheritance
    Object.setPrototypeOf(this, CustomError.prototype);
  }
}
