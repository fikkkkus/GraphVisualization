from fastapi import HTTPException, status
from neo4j import GraphDatabase
import logging

from app.models import GraphSegment

# Настройка логирования
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class UserData:
    def __init__(self, user_id, first_name, last_name, screen_name, followers, subscriptions_users, subscriptions_groups, sex=None, city=None, isEndTreeNode = False):
        self.id = user_id
        self.first_name = first_name
        self.last_name = last_name
        self.screen_name = screen_name
        self.followers = followers
        self.subscriptions_users = subscriptions_users
        self.subscriptions_groups = subscriptions_groups
        self.sex = sex
        self.city = city
        self.isEndTreeNode = isEndTreeNode

    @property
    def name(self):
        return f"{self.first_name} {self.last_name}"

class Neo4jDatabase:
    def __init__(self, uri, user, password, database=None):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.database = database


    def close(self):
        self.driver.close()

    def get_all_nodes(self):
        try:
            with self.driver.session(database=self.database) as session:
                query = """
                        MATCH (n)-[r]-(m)
                        RETURN 
                            n AS node, 
                            labels(n) AS node_labels, 
                            m AS related_node, 
                            labels(m) AS related_node_labels, 
                            type(r) AS relation_type,
                            CASE 
                                WHEN id(n) = id(startNode(r)) THEN 'out'
                                WHEN id(m) = id(startNode(r)) THEN 'in'
                                ELSE 'unknown'
                            END AS relation_direction
                """
                result = session.run(query)

                return [
                    {
                        "node": {**dict(record["node"]), "labels": record["node_labels"]},
                        "relation_type": f"{record['relation_type']} ({record['relation_direction']})",
                        "related_node": {**dict(record["related_node"]), "labels": record["related_node_labels"]}
                    }
                    for record in result
                ]
        except Exception as e:
            logger.debug(f"An error occurred while retrieving all nodes: {e}", exc_info=True)

    def get_nodes_by_id(self, node_id):
        try:
            with self.driver.session(database=self.database) as session:
                query = """
                    MATCH (n)-[r]-(m)
                    WHERE n.id = $node_id OR m.id = $node_id
                    RETURN 
                            n AS node, 
                            labels(n) AS node_labels, 
                            m AS related_node, 
                            labels(m) AS related_node_labels, 
                            type(r) AS relation_type,
                            CASE 
                                WHEN id(n) = id(startNode(r)) THEN 'out'
                                WHEN id(m) = id(startNode(r)) THEN 'in'
                                ELSE 'unknown'
                            END AS relation_direction
                """.replace("$node_id", node_id)

                result = session.run(query)

                return [
                    {
                        "node": {**dict(record["node"]), "labels": record["node_labels"]},
                        "relation_type": f"{record['relation_type']} ({record['relation_direction']})",
                        "related_node": {**dict(record["related_node"]), "labels": record["related_node_labels"]}
                    }
                    for record in result
                ]

        except Exception as e:
            logger.debug(f"An error occurred while retrieving nodes by ID: {e}", exc_info=True)

    # Функция для добавления сегмента графа
    def add_graph_segment(self, segment: GraphSegment):
        try:
            result = {
                "users_added": [],
                "groups_added": [],
                "relations_added": [],
                "errors": []
            }

            with self.driver.session(database=self.database) as session:
                # 1. Добавление пользователей (без передачи label)
                for user in segment.users:
                    try:
                        session.run(
                            "MERGE (u:User {id: $id})",  # Не передаем label, он будет определяться автоматически
                            id=int(user.id)
                        )
                        result["users_added"].append({"id": user.id, "status": "success"})
                    except Exception as e:
                        logger.debug(f"Error adding user {user.id}: {e}", exc_info=True)
                        result["errors"].append(f"Error adding user {user.id}: {str(e)}")

                # 2. Добавление групп (без передачи label)
                for group in segment.groups:
                    try:
                        session.run(
                            "MERGE (g:Group {id: $id})",  # Не передаем label, он будет определяться автоматически
                            id=int(group.id)
                        )
                        result["groups_added"].append({"id": group.id, "status": "success"})
                    except Exception as e:
                        logger.debug(f"Error adding group {group.id}: {e}", exc_info=True)
                        result["errors"].append(f"Error adding group {group.id}: {str(e)}")

                # 3. Протягивание связей
                for relation in segment.relations:
                    try:
                        start_id = relation.start_id
                        end_id = relation.end_id
                        rel_type = relation.type.lower()

                        # Проверка для связи "follow"
                        if rel_type == "follow":
                            follow_check_query = """
                                MATCH (u1 {id: $start_id}), (u2 {id: $end_id})
                                RETURN labels(u1) AS label1, labels(u2) AS label2
                            """
                            follow_check_result = session.run(follow_check_query, start_id=int(start_id),
                                                              end_id=int(end_id))

                            follow_check = follow_check_result.single()
                            if not follow_check:
                                result["errors"].append(f"Cannot follow: {start_id} or {end_id} is not a valid user.")
                                continue

                            label1 = follow_check["label1"]
                            label2 = follow_check["label2"]

                            # Проверяем, что оба узла являются пользователями
                            if "User" not in label1:
                                result["errors"].append(f"Cannot follow: {start_id} is not a valid user.")
                                continue
                            if "User" not in label2:
                                result["errors"].append(f"Cannot follow: {end_id} is not a valid user.")
                                continue

                            # Создаем связь Follow между пользователями
                            session.run(
                                """
                                MATCH (u:User {id: $start_id}), (target:User {id: $end_id})
                                MERGE (u)-[:Follow]->(target)
                                """,
                                start_id=int(start_id), end_id=int(end_id)
                            )
                            result["relations_added"].append({
                                "start_id": start_id,
                                "end_id": end_id,
                                "type": "follow",
                                "status": "success"
                            })

                        elif rel_type == "subscribe":
                            # Проверка для связи "subscribe" (от пользователя к группе)
                            subscribe_check_query = """
                                MATCH (u:User {id: $start_id}), (g:Group {id: $end_id})
                                RETURN labels(u) AS user_label, labels(g) AS group_label
                            """
                            subscribe_check_result = session.run(subscribe_check_query, start_id=int(start_id),
                                                                 end_id=int(end_id))

                            subscribe_check = subscribe_check_result.single()
                            if not subscribe_check:
                                result["errors"].append(f"Cannot subscribe: {start_id} or {end_id} is not valid.")
                                continue

                            user_label = subscribe_check["user_label"]
                            group_label = subscribe_check["group_label"]

                            # Проверяем, что start_id - это пользователь и end_id - это группа
                            if "User" not in user_label:
                                result["errors"].append(f"Cannot subscribe: {start_id} is not a valid user.")
                                continue
                            if "Group" not in group_label:
                                result["errors"].append(f"Cannot subscribe: {end_id} is not a valid group.")
                                continue

                            # Создаем связь Subscribe
                            session.run(
                                """
                                MATCH (u:User {id: $start_id}), (g:Group {id: $end_id})
                                MERGE (u)-[:Subscribe]->(g)
                                """,
                                start_id=int(start_id), end_id=int(end_id)
                            )
                            result["relations_added"].append({
                                "start_id": start_id,
                                "end_id": end_id,
                                "type": "subscribe",
                                "status": "success"
                            })

                        else:
                            result["errors"].append(f"Invalid relation type: {rel_type}")
                            continue

                    except Exception as e:
                        logger.debug(f"Error adding relation {relation}: {e}", exc_info=True)
                        result["errors"].append(f"Error adding relation {relation}: {str(e)}")

            # После завершения всех операций возвращаем результат
            return {
                "message": "Segment added successfully",
                "details": result
            }

        except Exception as e:
            logger.debug(f"Error adding graph segment: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error adding graph segment: {str(e)}"
            )

    def delete_graph_segment(self, node_id: str):
        try:
            with self.driver.session(database=self.database) as session:
                # Поиск узла с данным ID
                query_check = """
                    MATCH (n {id: $node_id}) RETURN n
                """.replace("$node_id", str(node_id))

                result_check = session.run(query_check)

                # Если узел не найден, возвращаем ошибку 404
                if result_check.single() is None:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Node with id {node_id} not found"
                    )

                # Если узел найден, удаляем его
                query_delete = """
                    MATCH (n {id: $node_id}) DETACH DELETE n
                """.replace("$node_id", str(node_id))

                session.run(query_delete)

                return {"message": f"Segment with id {node_id} deleted successfully"}

        except Exception as e:
            # В случае ошибки на уровне базы данных или выполнения запроса
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"An error occurred while deleting node {node_id}: {str(e)}"
            )

