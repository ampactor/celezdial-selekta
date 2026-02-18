import React, { createContext, useContext } from "react";

const ToneContext = createContext();
const ToneProvider = ({ children }) => {
  if (!children) return console.log("no children");

  return <ToneContext.Provider value={{}}>{children}</ToneContext.Provider>;
};

export const useAlert = () => useContext(ToneContext);

export default ToneProvider;
