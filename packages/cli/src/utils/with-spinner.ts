import ora from "ora";

export const withSpinner = async <T>(run: () => Promise<T>, spinnerText: string): Promise<T> => {
  const spinner = ora(spinnerText).start();
  try {
    const result = await run();
    spinner.succeed(spinnerText.replace(/\.$/, "") || spinnerText);
    return result;
  } catch (error) {
    spinner.fail(spinnerText.replace(/\.$/, "") || spinnerText);
    throw error;
  }
};
