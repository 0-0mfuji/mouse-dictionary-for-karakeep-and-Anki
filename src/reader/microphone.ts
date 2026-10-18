export const stopMicrophone = (stream: MediaStream | null): void => {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
};

export const acquireMicrophone = async (
  getStream: () => Promise<MediaStream>,
  isCurrent: () => boolean,
): Promise<MediaStream | null> => {
  if (!isCurrent()) return null;
  const stream = await getStream();
  if (!isCurrent()) {
    stopMicrophone(stream);
    return null;
  }
  return stream;
};
