package app.viktorych.tv.mesh; import java.util.*;
public class NostrRelayTest { public static void main(String[] a){
  byte[] sk=Crypto.random(32); final List<String> got=new ArrayList<>();
  NostrRelay r=new NostrRelay(Crypto.random(32),"u3qcn",new ArrayList<String>(),new NostrRelay.Listener(){
    public void onArea(String p,String n,String t,long ts,boolean m){got.add(n+":"+t);} public void onRelays(int u,int t){}});
  List<String[]> tags=new ArrayList<>(); tags.add(new String[]{"g","u3qcn"}); tags.add(new String[]{"n","tvtest"});
  String ev=NostrSign.event(sk,20000,tags,"hi \"there\"\n✓",8);
  r.onMessage("[\"EVENT\",\"vk-geo\","+ev+"]");
  r.onMessage("[\"EVENT\",\"vk-geo\","+ev+"]"); // duplicate
  r.onMessage("[\"EVENT\",\"vk-geo\","+ev.replace("hi ","ho ")+"]"); // tampered
  List<String[]> t2=new ArrayList<>(); t2.add(new String[]{"g","u3qcp"});
  r.onMessage("[\"EVENT\",\"vk-geo\","+NostrSign.event(sk,20000,t2,"other area",0)+"]");
  if(got.size()!=1||!got.get(0).equals("tvtest:hi \"there\"\n✓")) throw new RuntimeException("FAIL"); System.out.println("ok   nostr receive path: verify, area filter, dedup, tamper");
}}
