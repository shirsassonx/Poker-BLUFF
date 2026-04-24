import { Route, Switch } from "wouter";
import HoldemTable from "./pages/HoldemTable";
import Home from "./pages/Home";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/game" component={HoldemTable} />
    </Switch>
  );
}
