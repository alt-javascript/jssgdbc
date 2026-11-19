export class DriverManager {
  static _drivers = [];

  static registerDriver(driver) {
    this._drivers.push(driver);
  }

  static deregisterDriver(driver) {
    const index = this._drivers.indexOf(driver);
    if (index > -1) {
      this._drivers.splice(index, 1);
    }
  }

  static async getClient(url, properties) {
    for (const driver of this._drivers) {
      if (driver.acceptsURL(url)) {
        return await driver.connect(url, properties);
      }
    }
    throw new Error(`No suitable driver found for URL: ${url}`);
  }

  static getDrivers() {
    return [...this._drivers];
  }

  static clear() {
    this._drivers = [];
  }
}
